# Preview status

Implemented code paths: sidebar UI, authenticated companion, encrypted vault, UpCloud inventory/lifecycle/provisioning, SSH deployment, manual R2 snapshots, DNS/TLS, cluster creation and day-to-day workload operations, controller enrollment, heartbeat/metric collection, idle/lifetime stop policy, Basin report query/storage, and Markdown template loading.

Verification completed locally is recorded by the repository check workflow. Live UpCloud, DNS, certificates, Kubernetes, R2, Basin, and remote OpenChamber integration require an account-backed smoke test. No credentials or cloud resources are provisioned by cloning this repository.

Remaining work before a complete release:

- Live provider smoke test and installation/render test inside OpenChamber.
- Connection-completion/run tracking through a supported desktop integration; currently IDs identify connection requests and metric samples.
- Project app-service templates, HTTP health gates, and durable remote deployment supervision across SSH disconnects.
- Automatic pre-stop workspace backups, validated restore, snapshot retention, and crash recovery.
- Precise agent-idle reporting; current process detection intentionally errs toward staying on.
- Application log/trace collectors and richer performance analysis.
- Model/GitHub credential provisioning profiles and Cloudflare token minting.
- Third-party plugin discovery, Hermes/OpenClaw adapters, ChatGPT/Claude tool transports, and a selected local-RAG bridge.
- Kubernetes deletion, node draining, granular node-pool settings, and rollout tracking.
- Chosen public-preview authentication policy, final artwork, and open-source license.

Known operational edges: a heartbeat can arrive between a controller stop decision and the provider call; idle policy cannot guarantee zero races. Explicit lifetimes may interrupt work. Provider creation accepted before local state persistence fails can leave an untracked server: inspect inventory and import it before retrying. Failed enrollment can leave a controller policy installed before the server collector is configured. Retrying enrollment rotates the environment token. Keep idle disabled until collector health is verified.
