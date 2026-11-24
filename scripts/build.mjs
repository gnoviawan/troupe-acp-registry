#!/usr/bin/env node
// Validates overrides.json, logos/*.svg and agents/*.json, then writes
// dist/v1/troupe.json. Pass --offline to skip the upstream id-collision check.
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const UPSTREAM_URL = 'https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json'
const MAX_SVG_BYTES = 64 * 1024
const SCHEMA_VERSION = 1
const offline = process.argv.includes('--offline')

const errors = []
const fail = (where, message) => errors.push(`${where}: ${message}`)

const SAFE_ID = /^[A-Za-z0-9._-]{1,128}$/
const isSafeId = (id) => typeof id === 'string' && SAFE_ID.test(id) && id !== '.' && id !== '..'
const HEX = /^#[0-9A-Fa-f]{6}$/
const isHex = (value) => typeof value === 'string' && HEX.test(value)
const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const isStringArray = (value) => Array.isArray(value) && value.every((item) => typeof item === 'string')
const isStringMap = (value) => isPlainObject(value) && Object.values(value).every((item) => typeof item === 'string')

function checkKeys(where, value, allowed) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) fail(where, `unknown field "${key}"`)
  }
}

function checkBrandColor(where, brand) {
  if (!isPlainObject(brand)) return fail(where, 'brandColor must be an object')
  checkKeys(where, brand, ['light', 'dark', 'gradient'])
  if (!isHex(brand.light) || !isHex(brand.dark)) fail(where, 'brandColor.light and .dark must be #RRGGBB')
  if (brand.gradient === undefined) return
  const { gradient } = brand
  if (!isPlainObject(gradient)) return fail(where, 'brandColor.gradient must be an object')
  checkKeys(where, gradient, ['light', 'dark'])
  for (const side of ['light', 'dark']) {
    const stops = gradient[side]
    if (!Array.isArray(stops) || stops.length !== 2 || !stops.every(isHex)) {
      fail(where, `brandColor.gradient.${side} must be two #RRGGBB stops`)
    }
  }
}

function checkSvg(where, svg) {
  if (Buffer.byteLength(svg) > MAX_SVG_BYTES) fail(where, `larger than ${MAX_SVG_BYTES} bytes`)
  const root = svg.match(/<svg\b[^>]*>/i)?.[0]
  if (!root) return fail(where, 'no <svg> root')
  if (!/\bviewBox\s*=/i.test(root)) fail(where, 'root <svg> needs a viewBox')
  const banned = [
    [/<script\b/i, '<script>'],
    [/<foreignObject\b/i, '<foreignObject>'],
    [/<style\b/i, '<style> (it would style the whole app)'],
    [/<image\b/i, '<image>'],
    [/<a[\s>]/i, '<a>'],
    [/<!ENTITY/i, 'XML entities'],
    [/\son[a-z]+\s*=/i, 'event handler attributes'],
    [/\b(?:xlink:)?href\s*=\s*["'](?!#)/i, 'external href (only #fragment allowed)'],
    [/url\(\s*["']?(?!#)/i, 'external url() (only #fragment allowed)']
  ]
  for (const [pattern, label] of banned) {
    if (pattern.test(svg)) fail(where, `contains ${label}`)
  }
}

const PINNED_NPX = /^(@[^/@\s]+\/)?[^/@\s]+@\d[^\s]*$/
const PINNED_UVX = /^[A-Za-z0-9._-]+(\[[^\]]+\])?==\d[^\s]*$/

function checkLauncher(where, launcher, pinned) {
  if (!isPlainObject(launcher)) return fail(where, 'must be an object')
  checkKeys(where, launcher, ['package', 'args', 'env'])
  if (typeof launcher.package !== 'string' || !pinned.test(launcher.package)) {
    fail(where, `package must pin an exact version, got ${JSON.stringify(launcher.package)}`)
  }
  if (launcher.args !== undefined && !isStringArray(launcher.args)) fail(where, 'args must be strings')
  if (launcher.env !== undefined && !isStringMap(launcher.env)) fail(where, 'env must map strings')
}

const PLATFORMS = ['darwin-aarch64', 'darwin-x86_64', 'linux-aarch64', 'linux-x86_64', 'windows-aarch64', 'windows-x86_64']

function checkDistribution(where, distribution) {
  if (!isPlainObject(distribution)) return fail(where, 'distribution must be an object')
  checkKeys(where, distribution, ['npx', 'uvx', 'binary'])
  if (Object.keys(distribution).length === 0) fail(where, 'distribution is empty')
  if (distribution.npx !== undefined) checkLauncher(`${where}.npx`, distribution.npx, PINNED_NPX)
  if (distribution.uvx !== undefined) checkLauncher(`${where}.uvx`, distribution.uvx, PINNED_UVX)
  if (distribution.binary === undefined) return
  if (!isPlainObject(distribution.binary)) return fail(`${where}.binary`, 'must be an object')
  for (const [platform, target] of Object.entries(distribution.binary)) {
    const at = `${where}.binary.${platform}`
    if (!PLATFORMS.includes(platform)) fail(at, 'unknown platform')
    if (!isPlainObject(target)) {
      fail(at, 'must be an object')
      continue
    }
    checkKeys(at, target, ['cmd', 'archive', 'args', 'env'])
    if (typeof target.cmd !== 'string' || target.cmd.length === 0) fail(at, 'cmd is required')
    if (target.archive !== undefined && !/^https:\/\/\S+\.(zip|tar\.gz|tgz)$/.test(target.archive)) {
      fail(at, 'archive must be an https .zip or .tar.gz URL')
    }
    if (target.args !== undefined && !isStringArray(target.args)) fail(at, 'args must be strings')
    if (target.env !== undefined && !isStringMap(target.env)) fail(at, 'env must map strings')
  }
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    fail(path, `unreadable JSON (${error.message})`)
    return undefined
  }
}

async function listFiles(dir, extension) {
  const names = await readdir(join(ROOT, dir)).catch(() => [])
  return names.filter((name) => name.endsWith(extension)).sort()
}

async function loadLogos() {
  const logos = new Map()
  for (const file of await listFiles('logos', '.svg')) {
    const id = file.slice(0, -'.svg'.length)
    const where = `logos/${file}`
    if (!isSafeId(id)) {
      fail(where, 'file name is not a safe agent id')
      continue
    }
    const svg = (await readFile(join(ROOT, 'logos', file), 'utf8')).trim()
    checkSvg(where, svg)
    logos.set(id, svg)
  }
  return logos
}

async function loadOverrides(logos) {
  const raw = (await readJson(join(ROOT, 'overrides.json'))) ?? {}
  if (!isPlainObject(raw)) {
    fail('overrides.json', 'must be an object keyed by agent id')
    return []
  }
  const ids = new Set([...Object.keys(raw), ...logos.keys()])
  const overrides = []
  for (const id of [...ids].sort()) {
    const where = `overrides.json#${id}`
    if (!isSafeId(id)) fail(where, 'not a safe agent id')
    const entry = raw[id] ?? {}
    if (!isPlainObject(entry)) {
      fail(where, 'must be an object')
      continue
    }
    checkKeys(where, entry, ['name', 'hidden', 'brandColor'])
    if (entry.name !== undefined && (typeof entry.name !== 'string' || entry.name.length === 0 || entry.name.length > 64)) {
      fail(where, 'name must be 1 to 64 characters')
    }
    if (entry.hidden !== undefined && typeof entry.hidden !== 'boolean') fail(where, 'hidden must be a boolean')
    if (entry.brandColor !== undefined) checkBrandColor(where, entry.brandColor)
    overrides.push({ id, ...entry, ...(logos.has(id) ? { icon: logos.get(id) } : {}) })
  }
  return overrides
}

async function loadAgents() {
  const agents = []
  for (const file of await listFiles('agents', '.json')) {
    const where = `agents/${file}`
    const agent = await readJson(join(ROOT, 'agents', file))
    if (!isPlainObject(agent)) {
      fail(where, 'must be an object')
      continue
    }
    checkKeys(where, agent, ['id', 'name', 'version', 'description', 'distribution'])
    if (!isSafeId(agent.id) || `${agent.id}.json` !== file) fail(where, 'id must be safe and match the file name')
    for (const field of ['name', 'version', 'description']) {
      if (typeof agent[field] !== 'string' || agent[field].length === 0) fail(where, `${field} is required`)
    }
    checkDistribution(`${where}.distribution`, agent.distribution)
    agents.push(agent)
  }
  return agents
}

async function upstreamIds() {
  const response = await fetch(UPSTREAM_URL)
  if (!response.ok) throw new Error(`upstream registry returned ${response.status}`)
  const body = await response.json()
  return new Set((body.agents ?? []).map((agent) => agent.id))
}

const logos = await loadLogos()
const overrides = await loadOverrides(logos)
const agents = await loadAgents()

if (!offline) {
  const upstream = await upstreamIds()
  for (const agent of agents) {
    if (upstream.has(agent.id)) fail(`agents/${agent.id}.json`, 'id already exists upstream; use overrides.json instead')
  }
}

if (errors.length > 0) {
  for (const error of errors) console.error(`error ${error}`)
  console.error(`${errors.length} error(s)`)
  process.exit(1)
}

const out = join(ROOT, 'dist', 'v1')
await mkdir(out, { recursive: true })
await writeFile(join(out, 'troupe.json'), `${JSON.stringify({ schemaVersion: SCHEMA_VERSION, overrides, agents }, null, 2)}\n`)
await writeFile(join(ROOT, 'dist', '.nojekyll'), '')
console.log(`wrote dist/v1/troupe.json (${overrides.length} overrides, ${agents.length} agents)`)
