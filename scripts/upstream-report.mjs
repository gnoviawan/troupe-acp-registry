#!/usr/bin/env node
// Prints a Markdown report of upstream ACP agents that have no logo in logos/.
import { readdir } from 'node:fs/promises'

const UPSTREAM_URL = 'https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json'
const response = await fetch(UPSTREAM_URL)
if (!response.ok) throw new Error(`upstream registry returned ${response.status}`)
const { agents = [] } = await response.json()
const logos = new Set(
  (await readdir(new URL('../logos', import.meta.url))).filter((f) => f.endsWith('.svg')).map((f) => f.slice(0, -4))
)
const missing = agents.filter((agent) => !logos.has(agent.id)).sort((a, b) => a.id.localeCompare(b.id))

console.log(`Upstream lists ${agents.length} agents. ${missing.length} have no logo in \`logos/\`, so Troupe keeps its default icon for them.\n`)
console.log('Add `logos/<id>.svg` (and optionally a `brandColor` in `overrides.json`) to change one.\n')
for (const agent of missing) console.log(`- [ ] \`${agent.id}\` ${agent.name} ${agent.version}`)
