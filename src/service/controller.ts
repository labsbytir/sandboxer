import { z } from "zod";
import { settingsSchema, type Environment } from "../core/contracts";
import { readJSON, secret, putCredential, serialized } from "./store";
import { quote, ssh } from "./jobs";

export async function controller(path: string, body?: unknown) {
  const cfg = settingsSchema.parse(await readJSON("settings.json", {}));
  const url = new URL(cfg.controllerUrl);
  if (url.protocol !== "https:" || url.username || url.password)
    throw new Error("Configure an HTTPS controller URL");
  const response = await fetch(new URL(path, url), {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: "Bearer " + (await secret("controller")),
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok)
    throw new Error("Controller request failed (" + response.status + ")");
  return { text: await response.text(), url: url.origin };
}
export async function enroll(e: Environment, input: unknown) {
  const b = z
    .object({
      idleMinutes: z.number().int().min(0).max(10080),
      lifetimeMinutes: z.number().int().min(0).max(10080),
    })
    .parse(input);
  const result = await controller("/environments", {
    id: e.id,
    serverId: e.serverId,
    idleMinutes: b.idleMinutes,
    ...(b.lifetimeMinutes
      ? { stopAt: Date.now() + b.lifetimeMinutes * 60000 }
      : {}),
  });
  const { token } = z
    .object({ token: z.string().min(32) })
    .parse(JSON.parse(result.text));
  await serialized(() =>
    putCredential(
      e.id + "-controller",
      "controller",
      e.id + " heartbeat",
      token,
    ),
  );
  const config = Buffer.from(
    JSON.stringify({ id: e.id, url: result.url, token }),
  ).toString("base64");
  await ssh(
    e,
    `set -euo pipefail\nsudo install -d -m 0700 /etc/sandboxer\nprintf %s ${quote(config)} | base64 -d | sudo tee /etc/sandboxer/controller.json >/dev/null\nsudo chmod 0600 /etc/sandboxer/controller.json\nsudo systemctl restart sandboxer-collector.timer\nsudo systemctl start sandboxer-collector.service\n`,
  );
}
export async function configureTLS(e: Environment, input: unknown) {
  const b = z
    .object({ email: z.email(), port: z.number().int().min(1024).max(65535) })
    .parse(input);
  const token = await secret("cloudflare-dns");
  if (/[\r\n]/.test(token)) throw new Error("Invalid DNS credential");
  const domain = e.id + ".tirbox.site";
  const nginx = `server {\n listen 443 ssl;\n server_name ${domain};\n ssl_certificate /etc/letsencrypt/live/${domain}/fullchain.pem;\n ssl_certificate_key /etc/letsencrypt/live/${domain}/privkey.pem;\n location / {\n proxy_pass http://127.0.0.1:${b.port};\n proxy_http_version 1.1;\n proxy_set_header Host $host;\n proxy_set_header Upgrade $http_upgrade;\n proxy_set_header Connection "upgrade";\n }\n}\n`;
  await ssh(
    e,
    `set -euo pipefail\nsudo install -d -m 0700 /etc/letsencrypt/secrets\nprintf %s ${quote("dns_cloudflare_api_token = " + token + "\n")} | sudo tee /etc/letsencrypt/secrets/cloudflare.ini >/dev/null\nsudo chmod 0600 /etc/letsencrypt/secrets/cloudflare.ini\nsudo certbot certonly --non-interactive --agree-tos --dns-cloudflare --dns-cloudflare-credentials /etc/letsencrypt/secrets/cloudflare.ini --dns-cloudflare-propagation-seconds 60 -m ${quote(b.email)} -d ${quote(domain)}\nprintf %s ${quote(nginx)} | sudo tee /etc/nginx/sites-available/sandboxer >/dev/null\nsudo ln -sf /etc/nginx/sites-available/sandboxer /etc/nginx/sites-enabled/sandboxer\nsudo nginx -t\nsudo systemctl reload nginx\nprintf '%s\\n' '#!/bin/sh' 'systemctl reload nginx' | sudo tee /etc/letsencrypt/renewal-hooks/deploy/sandboxer >/dev/null\nsudo chmod 0755 /etc/letsencrypt/renewal-hooks/deploy/sandboxer\n`,
  );
}
