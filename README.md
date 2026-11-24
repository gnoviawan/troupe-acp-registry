# Troupe ACP registry

Troupe reads the official ACP registry (`cdn.agentclientprotocol.com`) for agents, versions and launch commands. This repository adds what Troupe shows on top of it, and agents that are not in the official registry.

Troupe fetches the published file at runtime, so a merged change here reaches users without a new Troupe build. Troupe also ships a copy of this file, so it keeps working offline.

Published file: `https://gnoviawan.github.io/troupe-acp-registry/v1/troupe.json`

## Change an agent's logo, colour or name

- Add `logos/<agent-id>.svg`. Any SVG with a `viewBox` works, including full-colour logos. Scripts, event handlers, `<foreignObject>` and external links are rejected. The limit is 64 KB.
- Add or edit the agent's entry in `overrides.json`:

```json
{
  "claude-acp": {
    "name": "Claude",
    "brandColor": { "light": "#C15F3C", "dark": "#D97757" },
    "hidden": false
  }
}
```

`brandColor` tints a single-colour (`currentColor`) logo per theme. It may also carry a `gradient` with two stops per theme. Leave it out for a full-colour logo. `hidden: true` removes the agent from Troupe's list.

## Add an agent that is not in the official registry

Add `agents/<agent-id>.json` in the official registry's agent format (`id`, `name`, `version`, `description`, `distribution`). `npx` and `uvx` packages must pin an exact version (`pkg@1.2.3`, `pkg==1.2.3`), and binary archives must be HTTPS. An id that already exists upstream is rejected. Use `overrides.json` for those.

## Build

```sh
node scripts/build.mjs            # validates and writes dist/v1/troupe.json
node scripts/build.mjs --offline  # skips the upstream id check
```

Every pull request runs the build. A push to `main` publishes `dist/` to GitHub Pages. A daily job keeps one issue listing the upstream agents that still have no logo here.
