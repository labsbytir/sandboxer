<p align="center"><img src="assets/icon.svg" width="112" alt="Sandboxer sandbox and shovel"></p>
<h1 align="center">Sandboxer</h1>
<p align="center">A home for your cloud development environments, inside OpenChamber.</p>
<p align="center">
  <a href="https://github.com/pennytir/sandboxer/actions/workflows/check.yml"><img src="https://github.com/pennytir/sandboxer/actions/workflows/check.yml/badge.svg" alt="Checks"></a>
  <img src="https://img.shields.io/badge/status-private_preview-blue" alt="Private preview">
  <img src="https://img.shields.io/badge/OpenChamber-2.4%2B-8b5cf6" alt="OpenChamber 2.4+">
  <img src="https://img.shields.io/badge/cloud-UpCloud-orange" alt="UpCloud">
  <img src="https://img.shields.io/badge/controller-Cloudflare-f38020" alt="Cloudflare">
  <img src="https://img.shields.io/badge/TypeScript-strict-3178c6" alt="TypeScript strict">
</p>

## What’s here

- **Machines:** discover existing UpCloud servers, import them, provision from cloud-init, start, stop, restart, and prepare an OpenChamber SSH connection.
- **Quick deploy:** 2-core/4 GB, 2-core/8 GB, 4-core/8 GB, and 4-core/16 GB presets; NYC1 by default. Markdown templates work in an Obsidian folder.
- **Remote development:** bootstrap Node, GitHub CLI, cloudflared, Wrangler, AWS CLI, OpenCode, and OpenChamber. Deploy and test a full commit SHA already on `staging`.
- **Kubernetes:** create clusters in an existing network, view node groups and workloads, scale, apply manifests, restart deployments, read logs, and request rolling upgrades.
- **Credentials:** encrypted local vault, macOS Keychain master key, and optional IP-restricted UpCloud child tokens.
- **Always-on controller:** Cloudflare Worker, D1 enrollment, fresh-heartbeat idle shutdown, explicit lifetime deadlines, and five-minute Markdown reports from Basin SQL into R2.
- **Preview URLs:** proxied DNS and Let’s Encrypt DNS-01 certificates at `<environment-id>.tirbox.site`.
- **Workspace snapshots:** upload working files and build artifacts to R2; the live filesystem remains on the server.
- **Agent plugins:** native Hermes and OpenClaw tool adapters live in `plugins/`; see [agent plugin setup](docs/agent-plugins.md).

**Private preview, not a production release.** Local checks and packaging are automated. Provider operations require your credentials and have not yet been verified against a live server. The controller is supplied as source and must be provisioned and deployed separately.

## Install

Requires OpenChamber 2.4+, local SSH, and `kubectl` for Kubernetes operations. Built panel and service files are committed, so OpenChamber does not need to compile them.

1. Clone this repository with your GitHub identity (the development repo is private; the public preview copy is [labsbytir/sandboxer](https://github.com/labsbytir/sandboxer)).
2. Open **OpenChamber → Settings → Extensions**.
3. Add the absolute path of this repository and approve its local service.
4. Open **Sandboxer** on the right rail. Add `upcloud` in **Keys**.

A Git installation can use the private repo’s `#staging` branch, or the public `labsbytir/sandboxer#staging` mirror, once OpenChamber’s Git identity has access. For the most predictable private-repository setup, use a local clone.

Follow [Setup](docs/setup.md) for the controller, credentials, remote connections, TLS, and backups.

## Develop

```sh
npm ci
npm run check
```

Edit `src/`, then run `npm run build` and reload the extension. After editing `bootstrap/`, regenerate the bundled template with `node scripts/templates.mjs`. After changing Worker bindings, run `npm run controller:types`.

`src/panel` is the SDK UI; `src/service` is the authenticated loopback companion; `src/providers` contains cloud adapters; `src/worker` is the offline-capable controller; `templates` contains cloud-init Markdown.

See [Extending Sandboxer](docs/extensions.md), [Telemetry](docs/telemetry.md), and [Preview limitations](docs/status.md).

## License & artwork

This repository is private and currently `UNLICENSED`; choose an open-source license before publishing. The bundled SVG is a code-drawn sandbox/shovel interpretation, not the original supplied raster artwork.
