import { readFile, writeFile } from "node:fs/promises";
import { stringify } from "yaml";
const files = await Promise.all(
  ["setup.sh", "collector.py"].map((name) =>
    readFile(`bootstrap/${name}`, "utf8"),
  ),
);
const config = {
  package_update: true,
  write_files: [
    { path: "/opt/sandboxer/setup.sh", permissions: "0755", content: files[0] },
    {
      path: "/opt/sandboxer/collector.py",
      permissions: "0755",
      content: files[1],
    },
    {
      path: "/etc/systemd/system/sandboxer-collector.service",
      content:
        "[Unit]\nDescription=Sandboxer heartbeat and metrics\nAfter=network-online.target\n[Service]\nType=oneshot\nExecStart=/usr/bin/python3 /opt/sandboxer/collector.py\n",
    },
    {
      path: "/etc/systemd/system/sandboxer-collector.timer",
      content:
        "[Unit]\nDescription=Sandboxer telemetry interval\n[Timer]\nOnBootSec=60\nOnUnitActiveSec=60\n[Install]\nWantedBy=timers.target\n",
    },
  ],
  runcmd: [["bash", "/opt/sandboxer/setup.sh"]],
};
await writeFile(
  "templates/ubuntu-development.md",
  `---\nid: ubuntu-development\nname: Ubuntu development\ndescription: Ubuntu 24.04 LTS with Node, GitHub CLI, cloudflared, Wrangler, AWS CLI, OpenCode and OpenChamber.\n---\n\n# Development sandbox\n\nSelect the Ubuntu 24.04 LTS image UUID from your UpCloud account. Bootstrap progress is in /var/log/cloud-init-output.log. Controller enrollment and TLS setup are separate authenticated actions.\n\n\`\`\`cloud-init\n${stringify(config)}\`\`\`\n`,
);
