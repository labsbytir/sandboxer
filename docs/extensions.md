# Extending Sandboxer

The interfaces in `src/core/contracts.ts` are the initial extension contracts. This preview uses compiled-in adapters; a discoverable third-party plugin loader is not implemented yet. Do not assume dropping a manifest into a folder executes it.

## Adapter categories

- **CloudProvider:** server discovery, plans, lifecycle; add provider-specific provisioning schemas beside the adapter.
- **ObservabilityProvider:** ingest events, query, and return Markdown reports. Basin is the initial controller implementation; another backend can implement the same interface.
- **AgentRuntime:** install, start, and health commands. OpenCode/OpenChamber are bundled in the Ubuntu template. Hermes and OpenClaw require their own reviewed templates and activity signals.
- **TemplateSource:** return validated Markdown/cloud-init templates. The built-in loader reads the bundled folder and one configured Obsidian folder, rejects duplicate IDs, and hashes source content for the action log.
- **StorageProvider:** put/get byte content; R2 snapshots currently use the AWS CLI remotely.
- **Chat:** the manifest reserves this category for ChatGPT/Claude tool integrations. Authentication and actual tool transports still need implementation; no browser-login credentials are copied.

## Add a cloud adapter

1. Implement `CloudProvider` under `src/providers/`.
2. Add a credential type and validation schema; resolve credentials in the companion only.
3. Select the adapter in the service’s `provider()` factory and extend environment identity to include the provider.
4. Add provisioning, controller lifecycle dispatch, UI options, and tests against the provider contract.
5. Keep stable Sandboxer environment IDs independent of provider resource IDs.

```ts
import type { CloudProvider } from "../src/core/contracts";

export function adapter(token: string): CloudProvider {
  return {
    async listServers() {
      /* authenticated provider request */ return [];
    },
    async listPlans() {
      /* normalize cores and MiB */ return [];
    },
    async action(id, action) {
      throw new Error("Implement provider lifecycle");
    },
  };
}
```

## Obsidian templates

Point **Settings → Obsidian template folder** at a directory containing Markdown files. Each needs unique `id`, `name`, optional `description` frontmatter, and one fenced `cloud-init` YAML mapping:

````markdown
---
id: my-project
name: My project
description: Project-specific development tools
---

```cloud-init
package_update: true
packages: [git, python3]
```
````

Templates execute with server root privileges. Identity, SSH user/key, password-login policy, and environment metadata are added by Sandboxer. A minimal custom template does not automatically inherit the default bootstrap: copy the bundled template when you need its tools and collector. Secrets are installed separately after provisioning.

## Local RAG and remote credentials

Local RAG remains local. A future bridge needs an explicit transport and provider choice, rather than copying the vault or exposing the laptop. Credentials saved under `model` or `github` are inventory only until an explicit provisioning adapter uses them. Keep OAuth and API-key flows distinct.
