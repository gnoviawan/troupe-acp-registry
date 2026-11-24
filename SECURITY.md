# Security policy

Troupe fetches `v1/troupe.json` from this repository on every install, draws its logos inline, and can launch the agents in `agents/`. A bad change here reaches every Troupe user within about an hour, so treat this repository as part of Troupe's supply chain.

## Reporting a vulnerability

Report privately through [GitHub's private vulnerability reporting](https://github.com/gnoviawan/troupe-acp-registry/security/advisories/new). Do not open a public issue.

## What every change must pass

- `scripts/build.mjs` rejects logos with scripts, `<style>`, `<image>`, `<a>`, `<foreignObject>`, event handlers or external links, and agents whose packages are not pinned to an exact version or whose ids already exist upstream. Troupe repeats the logo checks before it draws one.
- CodeQL scans the build scripts and the workflows on every pull request.
- Secret scanning with push protection, Dependabot alerts and Dependabot security updates are on.
- `main` only changes through a pull request that passes the `validate` check and has no new high or critical code scanning alert.
