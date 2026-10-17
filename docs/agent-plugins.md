# Sandboxer for Hermes and OpenClaw

Native tool plugins live in `plugins/hermes` and `plugins/openclaw`.
Both expose `sandboxer_read` and `sandboxer_action` using the existing companion
API. These are agent tools, not ports of the OpenChamber sidebar UI. They do not
install Hermes or OpenClaw on remote servers.

## Companion connection

Run `npm ci && npm run build` from the repository first. Start a standalone
companion in a terminal or your process manager with a private random token:

```sh
export SANDBOXER_SERVICE_TOKEN="$(openssl rand -hex 32)"
export SANDBOXER_SERVICE_PORT=47381
OPENCHAMBER_SERVICE_TOKEN="$SANDBOXER_SERVICE_TOKEN" \
  OPENCHAMBER_SERVICE_PORT="$SANDBOXER_SERVICE_PORT" node service/main.cjs
```

Give the agent host the same `SANDBOXER_SERVICE_TOKEN` and
`SANDBOXER_SERVICE_PORT` through its environment/secret manager. Do not put the
token in prompts or committed plugin configuration. Restart the host after
changing environment variables. The clients connect only to `127.0.0.1` and
refuse redirects. Run the companion alongside the agent host; it is not the
Cloudflare controller endpoint.

The companion uses the existing `~/.config/sandboxer` settings and encrypted
credentials (see [setup](setup.md)). Configure these through OpenChamber first,
then stop its Sandboxer extension service before starting the standalone
service against that same data directory. Concurrent services do not coordinate
their file writes. Do not extract OpenChamber's internal service token.

## Hermes

Copy `plugins/hermes/` into `~/.hermes/plugins/sandboxer/` (or the active
profile's plugin directory). The plugin uses only Python's standard library.

```sh
hermes plugins doctor ~/.hermes/plugins/sandboxer --ci
hermes plugins enable sandboxer
```

Restart Hermes with the companion environment configured. Both tools register
through `register(ctx)` with declared manifest ownership and JSON results.

## OpenClaw

This package targets OpenClaw `2026.10.4`; its experimental SDK must be checked
again before changing the host version. Use Node 24.16+ (or Node 26.1+).
After building from the repository root:

```sh
cd plugins/openclaw
npm pack
openclaw plugins install npm-pack:./labsbytir-sandboxer-openclaw-0.1.0.tgz
openclaw plugins inspect sandboxer --runtime --json
```

`sandboxer_action` is an optional tool. Add it to your existing `tools.allow`
configuration when you want the agent to perform operations. The read tool is
registered normally. Neither plugin changes host tool policy.

## Usage

- `sandboxer_read` with `{"path":"/environments"}` lists stable environment IDs.
- Read `/plans`, `/images`, `/templates` before creating a machine.
- `sandboxer_action` with `{"path":"/environments/env-0123456789abcdef/start"}`
  queues a start operation.
- Read `/jobs` to distinguish acceptance from successful completion.
- Read `/reports/env-0123456789abcdef` for the latest controller report.
- Use cluster `/nodes`, `/workloads`, `/logs`, `/scale`, `/apply`, `/restart`,
  `/add-nodes` and `/upgrade` operations for Kubernetes.

Tool descriptions list operation payloads; server-side validation is authoritative
(`src/service/api.ts`). Cluster creation requires name, network UUID, network_cidr,
zone, plan, control_plane_ip_filter, and node_groups (name, count, plan). Adding a
node group requires name, count and plan. Credential writes and settings writes
are deliberately absent from these tool routes; use the existing setup UI.

## Verification and limits

Repository tests exercise plugin registration, authenticated requests to a local
fixture, error handling, route restrictions and packaged OpenClaw output. Native
Hermes Doctor and OpenClaw runtime/install checks still need the actual hosts;
neither is installed in the development environment. No catalog/npm publication
has been made. Cloud operations retain the preview limitations in [status](status.md).

Sources: [Hermes plugin guide](https://hermes-agent.nousresearch.com/docs/developer-guide/plugins),
[OpenClaw plugin guide](https://docs.openclaw.ai/plugins/building-plugins).
