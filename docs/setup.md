# Setup

## Local credentials

Secrets belong in Sandboxer’s **Keys** panel, not Git or chat. Values are encrypted with AES-256-GCM and are never returned to the panel. macOS stores the encryption key in Keychain. Local state lives in `~/.config/sandboxer`; `actions.jsonl` records operation metadata, and `jobs.json` records asynchronous results. The companion has your OS user’s privileges.

Reserved credential IDs:

- `upcloud`: API token for server/Kubernetes management. Creating child tokens requires a parent with `can_create_tokens` permission.
- `cloudflare`: token with DNS edit for the `tirbox.site` zone, used locally for proxied A records.
- `cloudflare-dns`: separately scoped DNS-edit token for the same zone, transferred to the server for certificate issuance and renewal.
- `controller`: random administrator token matching the Worker’s `CONTROLLER_TOKEN` secret.
- `r2`: JSON `{"accessKeyId":"…","secretAccessKey":"…"}` scoped to your workspace bucket.
- Other IDs can hold model/GitHub/custom credentials. Saving them does not automatically install them on a server.

UpCloud child tokens inherit the account’s rights. Sandboxer restricts them to the server’s IPv4 address and 720-hour lifetime; they are **not** per-server permission scopes. The child token is encrypted locally and installed in `~/.config/sandboxer/upcloud.env` remotely. Revoke it in UpCloud when retiring a server. Cloudflare child-token minting is not implemented; provide a separate scoped DNS token.

Linux hosts need a manually provisioned `~/.config/sandboxer/master.key` containing 64 random hex characters, owned by the current user with mode 0600. Protect and back up that file separately from the encrypted vault. Host-managed extension services do not inherit arbitrary environment variables.

## First server

1. Choose an Ubuntu 24.04 LTS template UUID using **Deploy → List available images**.
2. Choose one of the available presets and paste your SSH **public** key.
3. Create the environment. **Activity** shows whether the provider accepted the request, not whether cloud-init has finished.
4. Use **Refresh** to retrieve the public IPv4 address. Verify its SSH host key through a trusted channel and make your first normal SSH connection before using automated actions. Sandboxer uses strict host-key checking.
5. Wait for `/var/lib/sandboxer-ready`; inspect `/var/log/cloud-init-output.log` on failures.
6. **Connect** supplies an SSH command for **Settings → Remote Instances → Add → Managed**. OpenChamber manages the remote service and forwarding. Connection-request IDs are logged; the extension does not claim to detect completed desktop connections.

The remote machine needs its own GitHub deploy key or `gh` authentication for private repositories. Do not forward your SSH agent by default. Remote model authentication is separate from desktop authentication. Local RAG configuration is not modified or copied.

## Always-on controller

Use the account that will own Sandboxer’s controller. Create a D1 database and two R2 buckets (reports and workspaces) with your Cloudflare tooling/dashboard. Replace the placeholder D1 UUID and report bucket in `wrangler.jsonc`; set `ACCOUNT_ID`, `BASIN_BUCKET`, `BASIN_TABLE`, and `PIPELINE_URL` after configuring [Basin](telemetry.md).

```sh
npm run controller:types
npx wrangler d1 migrations apply sandboxer --remote
npx wrangler secret put CONTROLLER_TOKEN
npx wrangler secret put UPCLOUD_TOKEN
npx wrangler secret put BASIN_TOKEN
# Only if your ingestion endpoint requires a bearer token:
npx wrangler secret put PIPELINE_TOKEN
npm run controller:deploy
```

These are deployment steps for your configured account, not commands run automatically by the extension. Enter secrets through interactive prompts. `UPCLOUD_TOKEN` must be usable from Workers; a token restricted to your server IP cannot serve this purpose.

Set the Worker’s HTTPS URL in Sandboxer **Settings**, store the matching `controller` credential, and use **Enroll controller** for each bootstrapped environment. Enrollment installs a separate heartbeat token remotely. A failed installation requires retrying enrollment. The Worker keeps lifetime policy even if your laptop closes.

The collector sends heartbeats every minute. Idle shutdown requires a heartbeat younger than two minutes, no SSH connections, no job leases in `/run/sandboxer/jobs`, and no recognized agent processes. Persistent agent daemons deliberately keep the server on. Unknown background workloads must create a lease or use idle timeout 0. Explicit lifetime deadlines override activity. Cron runs every five minutes, so deadlines are not second-accurate. Stopping compute does not delete disks or eliminate storage charges.

## DNS and TLS

Set the Cloudflare zone ID, then **Configure DNS**. Set the application’s localhost port and certificate email, then **Configure TLS**. This installs an nginx reverse proxy, obtains a real Let’s Encrypt certificate using DNS-01, and reloads nginx after renewal. Set Cloudflare SSL mode to **Full (strict)**. Run the app on the configured localhost port before testing.

The preview endpoint is public unless you configure Cloudflare Access or application authentication. Keep the OpenChamber management service on SSH forwarding; do not point the public preview proxy at it. Access-policy automation is not included yet.

## Staging deployment and snapshots

Commit and push your project to `staging` first. Enter `owner/repository`, its full 40-character commit SHA, and project-specific install/build/test/start commands. Sandboxer verifies the SHA is reachable from the remote staging branch, builds in a release directory, runs tests, and changes `current` only after tests pass. The start command must configure or restart your actual app service. A failed start restores the previous symlink and attempts the same restart there; application health checks are not yet automatic.

Configure an R2 account ID and workspace bucket, then **Save to R2** using the repository’s folder name. Archives include working-tree changes, releases, and artifacts. They exclude `.git`, `.env*`, key files, virtualenvs, and node_modules. Other application secrets must be excluded in your own template/workflow. Snapshot consistency is not guaranteed during concurrent writes: pause writers first. Automatic pre-stop snapshots and restore UI are not implemented. Download with the S3 CLI and extract into a fresh directory after inspecting the archive.

## Kubernetes

Create a cluster in an existing network in the chosen zone. Supply the matching CIDR, a current control-plane plan, and allowed API CIDRs. Install `kubectl` locally. Sandboxer fetches a short-lived temporary kubeconfig for each operation and removes it afterward; configurations using credential-exec plugins are rejected. Provider acceptance is not the same as rollout readiness; inspect workloads after mutations.
