---
id: ubuntu-development
name: Ubuntu development
description: Ubuntu 24.04 LTS with Node, GitHub CLI, cloudflared, Wrangler, AWS CLI, OpenCode and OpenChamber.
---

# Development sandbox

Select the Ubuntu 24.04 LTS image UUID from your UpCloud account. Bootstrap progress is in /var/log/cloud-init-output.log. Controller enrollment and TLS setup are separate authenticated actions.

```cloud-init
package_update: true
write_files:
  - path: /opt/sandboxer/setup.sh
    permissions: "0755"
    content: >
      #!/usr/bin/env bash

      set -euo pipefail

      export DEBIAN_FRONTEND=noninteractive

      apt-get update

      apt-get install -y ca-certificates curl gnupg git gh jq unzip python3
      python3-venv nginx certbot python3-certbot-dns-cloudflare build-essential
      awscli

      install -d -m 0755 /etc/apt/keyrings

      curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg
      --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg

      echo 'deb [signed-by=/etc/apt/keyrings/nodesource.gpg]
      https://deb.nodesource.com/node_22.x nodistro main' >
      /etc/apt/sources.list.d/nodesource.list

      curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg -o
      /etc/apt/keyrings/cloudflare-main.gpg

      echo 'deb [signed-by=/etc/apt/keyrings/cloudflare-main.gpg]
      https://pkg.cloudflare.com/cloudflared any main' >
      /etc/apt/sources.list.d/cloudflared.list

      apt-get update

      apt-get install -y nodejs cloudflared

      npm install -g wrangler@4.151.1 opencode-ai@1.19.3 @openchamber/web@2.4.0

      loginctl enable-linger sandboxer

      install -d -o sandboxer -g sandboxer /home/sandboxer/sandboxer/projects

      systemctl enable --now sandboxer-collector.timer

      systemctl enable --now certbot.timer

      printf 'Sandboxer bootstrap complete\n' > /var/lib/sandboxer-ready
  - path: /opt/sandboxer/collector.py
    permissions: "0755"
    content: >
      #!/usr/bin/env python3

      """Fail-safe host telemetry; secrets live in a root-readable enrollment
      file."""

      import datetime

      import json

      import os

      import pathlib

      import shutil

      import subprocess

      import urllib.request

      import uuid


      CONFIG = pathlib.Path('/etc/sandboxer/controller.json')


      def send(config, operation, body):
          request = urllib.request.Request(
              config['url'] + '/environments/' + config['id'] + '/' + operation,
              data=json.dumps(body).encode(),
              headers={'Authorization': 'Bearer ' + config['token'], 'Content-Type': 'application/json'},
          )
          with urllib.request.urlopen(request, timeout=15) as response:
              response.read(1024)

      def main():
          if not CONFIG.exists():
              return
          config = json.loads(CONFIG.read_text())
          processes = subprocess.check_output(['ps', '-eo', 'comm='], text=True).splitlines()
          # Persistent agent daemons inhibit idle shutdown, even when apparently quiet.
          jobs = sum(p.strip() in {'opencode', 'claude', 'codex', 'hermes', 'openclaw'} for p in processes)
          sockets = subprocess.check_output(['ss', '-Htn', 'state', 'established', '( sport = :22 )'], text=True)
          connections = len(sockets.splitlines())
          leases = pathlib.Path('/run/sandboxer/jobs')
          jobs += len(list(leases.iterdir())) if leases.exists() else 0
          send(config, 'heartbeat', {'activeJobs': jobs, 'activeConnections': connections, 'active': jobs + connections > 0})
          memory = dict((line.split(':')[0], int(line.split()[1])) for line in pathlib.Path('/proc/meminfo').read_text().splitlines())
          disk = shutil.disk_usage('/')
          send(config, 'telemetry', [{
              'timestamp': datetime.datetime.now(datetime.timezone.utc).isoformat().replace('+00:00', 'Z'),
              'kind': 'host.metrics', 'run_id': str(uuid.uuid4()),
              'cpu_load': os.getloadavg()[0],
              'memory_used_pct': 100 * (1 - memory['MemAvailable'] / memory['MemTotal']),
              'disk_used_pct': 100 * disk.used / disk.total,
          }])

      if __name__ == '__main__':
          main()
  - path: /etc/systemd/system/sandboxer-collector.service
    content: |
      [Unit]
      Description=Sandboxer heartbeat and metrics
      After=network-online.target
      [Service]
      Type=oneshot
      ExecStart=/usr/bin/python3 /opt/sandboxer/collector.py
  - path: /etc/systemd/system/sandboxer-collector.timer
    content: |
      [Unit]
      Description=Sandboxer telemetry interval
      [Timer]
      OnBootSec=60
      OnUnitActiveSec=60
      [Install]
      WantedBy=timers.target
runcmd:
  - - bash
    - /opt/sandboxer/setup.sh
```
