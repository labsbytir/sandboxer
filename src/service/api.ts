import { z } from "zod";
import { randomUUID } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isIP } from "node:net";
import {
  settingsSchema,
  identifier,
  newEnvironmentId,
  presetSizes,
  type Environment,
} from "../core/contracts";
import { UpCloud } from "../providers/upcloud";
import {
  audit,
  credentials,
  putCredential,
  readAudit,
  readJSON,
  saveJSON,
  secret,
  serialized,
  dataDir,
} from "./store";
import { templates, renderCloudInit } from "./templates";
import { startJob, listJobs, ssh, deploymentScript, quote } from "./jobs";
import { kubectl } from "./kubernetes";
import { controller, enroll, configureTLS } from "./controller";
const envs = () => readJSON<Environment[]>("environments.json", []);
const settings = async () =>
  settingsSchema.parse(await readJSON("settings.json", {}));
async function provider(credentialId = "upcloud") {
  return new UpCloud(await secret(credentialId));
}
async function environment(id: string) {
  const row = (await envs()).find((e) => e.id === id);
  if (!row) throw new Error("Environment not found");
  return row;
}
export async function api(
  method: string,
  path: string,
  body: unknown,
): Promise<unknown> {
  if (method === "GET" && path === "/health") return { ok: true };
  if (method === "GET" && path === "/settings") return settings();
  if (method === "PUT" && path === "/settings") {
    const parsed = settingsSchema.parse(body);
    return serialized(async () => {
      await saveJSON("settings.json", parsed);
      await audit("settings.update", "local", "succeeded");
      return { ok: true };
    });
  }
  if (method === "GET" && path === "/credentials")
    return (await credentials()).map(({ id, kind, label }) => ({
      id,
      kind,
      label,
    }));
  if (method === "POST" && path === "/credentials") {
    const c = z
      .object({
        id: identifier,
        kind: identifier,
        label: z.string().min(1).max(100),
        value: z.string().min(1).max(64000),
      })
      .parse(body);
    return serialized(async () => {
      await putCredential(c.id, c.kind, c.label, c.value);
      await audit("credential.save", c.id, "succeeded");
      return { ok: true };
    });
  }
  if (method === "GET" && path === "/environments") return envs();
  if (method === "GET" && path === "/servers")
    return (await provider()).listServers();
  if (method === "GET" && path === "/plans") {
    return (await (await provider()).listPlans()).filter((p) =>
      presetSizes.some(
        (s) =>
          s.cores === Number(p.core_number) &&
          s.memory === Number(p.memory_amount),
      ),
    );
  }
  if (method === "GET" && path === "/images")
    return (await provider()).request("/storage/template");
  if (method === "GET" && path === "/templates")
    return templates((await settings()).vaultPath);
  if (method === "GET" && path === "/audit") return readAudit();
  if (method === "GET" && path === "/jobs") return listJobs();
  if (method === "GET" && path === "/controller")
    return JSON.parse((await controller("/environments")).text);
  const reportMatch = path.match(/^\/reports\/(env-[a-f0-9]{16})$/);
  if (method === "GET" && reportMatch)
    return { text: (await controller("/reports/" + reportMatch[1])).text };
  if (method === "GET" && path === "/clusters")
    return (await provider()).listClusters();
  if (method === "GET" && path === "/cluster-plans")
    return (await provider()).request("/kubernetes/plans");
  if (method === "POST" && path === "/clusters") {
    const b = z
      .object({
        name: z.string().regex(/^[a-z0-9][a-z0-9-]{1,53}[a-z0-9]$/),
        network: z.uuid(),
        network_cidr: z.cidrv4(),
        zone: identifier,
        plan: identifier,
        control_plane_ip_filter: z.array(z.cidrv4()).min(1),
        node_groups: z
          .array(
            z.object({
              name: identifier,
              count: z.number().int().min(1).max(100),
              plan: identifier,
            }),
          )
          .min(1),
      })
      .parse(body);
    return startJob("cluster.create", b.name, async () => {
      await (await provider()).request("/kubernetes", "POST", b);
    });
  }
  if (method === "POST" && path === "/environments") {
    const b = z
      .object({
        name: z.string().min(1).max(100),
        plan: identifier,
        image: z.uuid(),
        template: identifier,
        sshKey: z.string().regex(/^ssh-(ed25519|rsa) [A-Za-z0-9+/=]+(?: .*)?$/),
        credentialId: identifier.default("upcloud"),
      })
      .parse(body);
    const cfg = await settings(),
      p = await provider(b.credentialId),
      all = await templates(cfg.vaultPath),
      t = all.find((t) => t.id === b.template);
    if (!t) throw new Error("Template not found");
    const plan = (await p.listPlans()).find((p) => p.name === b.plan);
    if (
      !plan ||
      !presetSizes.some(
        (s) =>
          s.cores === Number(plan.core_number) &&
          s.memory === Number(plan.memory_amount),
      )
    )
      throw new Error("Choose an available preset plan");
    const id = newEnvironmentId();
    return startJob("environment.create", id, async () => {
      const { server } = await p.create({
        zone: cfg.zone,
        plan: b.plan,
        title: b.name,
        hostname: id,
        metadata: "yes",
        login_user: {
          username: "sandboxer",
          ssh_keys: { ssh_key: [b.sshKey] },
        },
        storage_devices: {
          storage_device: [
            {
              action: "clone",
              storage: b.image,
              title: id,
              size: plan.storage_size,
              tier: "maxiops",
            },
          ],
        },
        user_data: renderCloudInit(t, id, b.sshKey),
      });
      await serialized(async () => {
        await saveJSON("environments.json", [
          ...(await envs()),
          {
            id,
            serverId: server.uuid,
            name: b.name,
            zone: cfg.zone,
            plan: b.plan,
            createdAt: new Date().toISOString(),
            idleMinutes: cfg.idleMinutes,
            sshUser: "sandboxer",
            credentialId: b.credentialId,
          },
        ]);
        await audit("template.used", `${id}:${t.digest}`, "succeeded");
      });
    });
  }
  if (method === "POST" && path === "/environments/adopt") {
    const b = z
      .object({
        serverId: z.uuid(),
        credentialId: identifier.default("upcloud"),
        sshUser: identifier.default("sandboxer"),
      })
      .parse(body);
    const p = await provider(b.credentialId);
    const { server } = await p.request<{
      server: import("../core/contracts").Server;
    }>(`/server/${b.serverId}`);
    const ip = server.ip_addresses?.ip_address.find(
      (i) => i.access === "public" && i.family === "IPv4",
    )?.address;
    return serialized(async () => {
      const rows = await envs();
      if (rows.some((e) => e.serverId === b.serverId))
        throw new Error("Server already added");
      const row: Environment = {
        id: newEnvironmentId(),
        serverId: server.uuid,
        name: server.title,
        zone: server.zone,
        plan: server.plan || "",
        createdAt: new Date().toISOString(),
        idleMinutes: 0,
        host: ip,
        sshUser: b.sshUser,
        credentialId: b.credentialId,
      };
      await saveJSON("environments.json", [...rows, row]);
      await audit("environment.adopt", row.id, "succeeded");
      return row;
    });
  }
  let match = path.match(
    /^\/environments\/(env-[a-f0-9]{16})\/(start|stop|restart|connect|deploy|refresh|server-key|dns|snapshot|enroll|tls)$/,
  );
  if (method === "POST" && match) {
    const [, id, action] = match,
      e = await environment(id),
      p = await provider(e.credentialId);
    if (action === "enroll")
      return startJob("controller.enroll", id, () => enroll(e, body));
    if (action === "tls")
      return startJob("tls.configure", id, () => configureTLS(e, body));
    if (action === "refresh") {
      const { server } = await p.request<{
        server: import("../core/contracts").Server;
      }>(`/server/${e.serverId}`);
      const host = server.ip_addresses?.ip_address.find(
        (i) => i.access === "public" && i.family === "IPv4",
      )?.address;
      return serialized(async () => {
        await saveJSON(
          "environments.json",
          (await envs()).map((row) => (row.id === id ? { ...row, host } : row)),
        );
        return { server, host };
      });
    }
    if (action === "start" || action === "stop" || action === "restart")
      return startJob("environment." + action, id, async () => {
        await p.action(e.serverId, action);
      });
    if (action === "connect") {
      if (!e.host)
        throw new Error("Refresh this environment to retrieve its IP");
      const runId = randomUUID();
      await audit("connection.request", `${id}:${runId}`, "succeeded");
      return {
        runId,
        sshCommand: `ssh ${e.sshUser}@${e.host}`,
        instructions:
          "Settings → Remote Instances → Add. Paste the SSH command; select managed. This run records the connection request, not a confirmed live connection.",
      };
    }
    if (action === "server-key") {
      if (!e.host || isIP(e.host) !== 4)
        throw new Error("Refresh environment first");
      return startJob("credential.server-key", id, async () => {
        const token = await p.createServerToken(id, e.host!);
        await serialized(async () => {
          await putCredential(
            id + "-upcloud",
            "upcloud",
            id + " server key",
            token.token,
          );
          await saveJSON(
            "environments.json",
            (await envs()).map((row) =>
              row.id === id ? { ...row, childTokenId: token.id } : row,
            ),
          );
        });
        await ssh(
          e,
          `umask 077\nmkdir -p "$HOME/.config/sandboxer"\ncat > "$HOME/.config/sandboxer/upcloud.env" <<'SANDBOXER_TOKEN'\nUPCLOUD_TOKEN=${token.token}\nSANDBOXER_TOKEN\n`,
        );
      });
    }
    if (action === "deploy") {
      const b = z
        .object({
          repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
          sha: z.string().regex(/^[a-f0-9]{40}$/),
          install: z.string().max(4000),
          build: z.string().max(4000),
          test: z.string().min(1).max(4000),
          start: z.string().min(1).max(4000),
        })
        .parse(body);
      return startJob("deployment", id, async () => {
        await ssh(
          e,
          deploymentScript(b.repo, b.sha, b.install, b.build, b.test, b.start),
        );
      });
    }
    if (action === "dns") {
      const cfg = await settings();
      if (!cfg.cloudflareZoneId || !e.host)
        throw new Error("Configure Cloudflare zone and refresh environment IP");
      const token = await secret("cloudflare");
      return startJob("dns.upsert", id, async () => {
        const base = `https://api.cloudflare.com/client/v4/zones/${encodeURIComponent(cfg.cloudflareZoneId)}/dns_records`;
        const headers = {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        };
        const hostname = id + ".tirbox.site";
        const lookup = await fetch(base + "?name=" + hostname, {
          headers,
          signal: AbortSignal.timeout(15000),
        });
        if (!lookup.ok) throw new Error("DNS lookup failed");
        const found = (await lookup.json()) as { result: { id: string }[] };
        const res = await fetch(
          base + (found.result[0] ? "/" + found.result[0].id : ""),
          {
            method: found.result[0] ? "PUT" : "POST",
            headers,
            body: JSON.stringify({
              type: "A",
              name: hostname,
              content: e.host,
              proxied: true,
              ttl: 1,
            }),
            signal: AbortSignal.timeout(15000),
          },
        );
        if (!res.ok) throw new Error("DNS update failed");
      });
    }
    if (action === "snapshot") {
      const b = z.object({ project: identifier }).parse(body);
      const cfg = await settings();
      const r2 = z
        .object({ accessKeyId: z.string(), secretAccessKey: z.string() })
        .parse(JSON.parse(await secret("r2")));
      if (!/^[a-f0-9]{32}$/.test(cfg.r2AccountId) || !cfg.r2Bucket)
        throw new Error("Configure R2 account and bucket");
      return startJob("snapshot", id, async () => {
        await ssh(
          e,
          `set -euo pipefail\nexport AWS_ACCESS_KEY_ID=${quote(r2.accessKeyId)} AWS_SECRET_ACCESS_KEY=${quote(r2.secretAccessKey)}\ncd "$HOME/sandboxer/projects/${b.project}"\nSNAP=$(mktemp)\ntrap 'rm -f "$SNAP"' EXIT\ntar --exclude=node_modules --exclude=.env --exclude='.env.*' --exclude=.git --exclude=.venv --exclude='*.pem' --exclude='*.key' -czf "$SNAP" .\naws --endpoint-url ${quote("https://" + cfg.r2AccountId + ".r2.cloudflarestorage.com")} s3 cp "$SNAP" ${quote("s3://" + cfg.r2Bucket + "/" + id + "/" + b.project + "/" + Date.now() + ".tar.gz")}\n`,
        );
      });
    }
  }
  match = path.match(
    /^\/clusters\/([a-f0-9-]+)\/(nodes|workloads|logs|restart|scale|apply|upgrade|add-nodes)$/,
  );
  if (match) {
    const [, id, action] = match;
    z.uuid().parse(id);
    const p = await provider();
    if (method === "GET" && action === "nodes")
      return p.cluster(id, "/node-groups");
    if (method === "POST" && action === "add-nodes") {
      const b = z
        .object({
          name: identifier,
          count: z.number().int().min(1).max(100),
          plan: identifier,
        })
        .parse(body);
      return startJob("cluster.add-nodes", id, async () => {
        await p.cluster(id, "/node-groups", "POST", b);
      });
    }
    if (method === "GET" && action === "workloads")
      return JSON.parse(
        await kubectl(p, id, [
          "get",
          "pods,deployments,services",
          "--all-namespaces",
          "-o",
          "json",
        ]),
      );
    if (method === "POST" && action === "scale") {
      const b = z
        .object({ group: identifier, count: z.number().int().min(0).max(100) })
        .parse(body);
      return startJob("cluster.scale", id, async () => {
        await p.cluster(
          id,
          "/node-groups/" + encodeURIComponent(b.group),
          "PATCH",
          { count: b.count },
        );
      });
    }
    if (method === "POST" && action === "upgrade") {
      const b = z
        .object({ version: z.string().regex(/^\d+\.\d+$/) })
        .parse(body);
      return startJob("cluster.upgrade", id, async () => {
        await p.cluster(id, "/upgrade", "POST", {
          version: b.version,
          strategy: { type: "rolling-update" },
        });
      });
    }
    if (method === "POST" && action === "logs") {
      const b = z
        .object({ namespace: identifier, pod: identifier })
        .parse(body);
      return {
        text: await kubectl(p, id, [
          "logs",
          b.pod,
          "-n",
          b.namespace,
          "--tail=200",
          "--all-containers=true",
        ]),
      };
    }
    if (method === "POST" && action === "restart") {
      const b = z
        .object({ namespace: identifier, deployment: identifier })
        .parse(body);
      return startJob("cluster.restart", id, async () => {
        await kubectl(p, id, [
          "rollout",
          "restart",
          "deployment/" + b.deployment,
          "-n",
          b.namespace,
        ]);
      });
    }
    if (method === "POST" && action === "apply") {
      const b = z.object({ yaml: z.string().min(1).max(200000) }).parse(body);
      return startJob("cluster.apply", id, async () => {
        await kubectl(p, id, ["apply", "-f", "-"], b.yaml);
      });
    }
  }
  throw new Error("Unknown operation");
}
