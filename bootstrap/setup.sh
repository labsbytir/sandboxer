#!/usr/bin/env bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl gnupg git gh jq unzip python3 python3-venv nginx certbot python3-certbot-dns-cloudflare build-essential awscli
install -d -m 0755 /etc/apt/keyrings
curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
echo 'deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main' > /etc/apt/sources.list.d/nodesource.list
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg -o /etc/apt/keyrings/cloudflare-main.gpg
echo 'deb [signed-by=/etc/apt/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main' > /etc/apt/sources.list.d/cloudflared.list
apt-get update
apt-get install -y nodejs cloudflared
npm install -g wrangler@4.151.1 opencode-ai@1.19.3 @openchamber/web@2.4.0
loginctl enable-linger sandboxer
install -d -o sandboxer -g sandboxer /home/sandboxer/sandboxer/projects
systemctl enable --now sandboxer-collector.timer
systemctl enable --now certbot.timer
printf 'Sandboxer bootstrap complete\n' > /var/lib/sandboxer-ready
