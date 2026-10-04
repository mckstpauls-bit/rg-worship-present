# Publishing RG-Present

Created by **RG DEV Industries** · rgdev.ke@gmail.com

## One-time: put the code on GitHub

The repository is already initialised and committed locally on the `main` branch.

**With the GitHub CLI** (easiest):

```bash
winget install --id GitHub.cli -e
gh auth login
gh repo create rg-worship-present --public --source=. --remote=origin --push
```

**Or by hand:** create an empty public repository called `rg-worship-present` at
<https://github.com/new> (no README, no .gitignore — this repo already has them), then:

```bash
git remote add origin https://github.com/YOUR-ACCOUNT/rg-worship-present.git
git push -u origin main
```

## Releasing a new version

```bash
npm version 1.2.0        # bumps package.json and makes a git tag
git push --follow-tags
```

Pushing the tag runs `.github/workflows/release.yml`, which on a GitHub Windows runner builds the
icons, the content packs and the installer, then publishes a Release containing:

- `RG-Present-Setup-1.2.0.exe`
- every `*.rgpkg` content pack
- `updates.json` with SHA-256 checksums for all of them

## Pointing the churches' computers at it

Once, on each computer: **Settings → Updates → Update source**

```
https://github.com/YOUR-ACCOUNT/rg-worship-present/releases/latest/download/updates.json
```

From then on each machine checks quietly at startup and offers the update with one click. Because
the repository is public, no login or token is needed on the church computers.

Prefer not to rely on the internet during a service? Run `npm run make-feed -- "\church-server\rgpresent"`
instead and point the computers at that folder on the local network. Both work the same way.

## What is deliberately not in this repository

- **Copyrighted Bible translations** (NIV, HCSB and so on). Only the public-domain King James Version
  is included. Each church imports translations it is licensed to use, through
  Settings → Import Bible, or `RG-Present.exe --install-bible <file> --abbrev NIV`.
- `node_modules/`, `dist/`, the built `content/*.rgpkg` and generated icons — all rebuilt by the workflow.
