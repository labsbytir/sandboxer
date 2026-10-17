#!/usr/bin/env python3
"""Fail-safe host telemetry; secrets live in a root-readable enrollment file."""
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
