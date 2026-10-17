import { connectHost } from "@openchamber/sdk";
import {
  applyHostReady,
  mountTabs,
  mountButton,
  mountTextField,
  mountSelect,
} from "@openchamber/sdk/ui";
import type {
  Environment,
  Server,
  Plan,
  Template,
  Settings,
} from "../core/contracts";
const host = connectHost(),
  main = document.querySelector<HTMLElement>("#main")!,
  message = document.querySelector<HTMLElement>("#message")!;
let mounted = false,
  tab = "environments",
  generation = 0;
let disposers: Array<() => void> = [];
function el(tag: string, parent: HTMLElement, text = "", className = "") {
  const e = document.createElement(tag);
  e.textContent = text;
  e.className = className;
  parent.append(e);
  return e;
}
function output(parent: HTMLElement, data: unknown) {
  return el(
    "pre",
    parent,
    typeof data === "string" ? data : JSON.stringify(data, null, 2),
  );
}
function button(
  parent: HTMLElement,
  label: string,
  fn: () => Promise<unknown> | void,
  destructive = false,
) {
  const root = el("span", parent);
  const b = mountButton(root, {
    label,
    variant: destructive ? "destructive" : "secondary",
    size: "sm",
    onClick: () => {
      b.update({ loading: true });
      message.textContent = "";
      Promise.resolve()
        .then(fn)
        .catch((e) => (message.textContent = e.message))
        .finally(() => b.update({ loading: false }));
    },
  });
  disposers.push(() => b.dispose());
  return b;
}
function field(
  parent: HTMLElement,
  label: string,
  value = "",
  password = false,
  multiline = false,
) {
  const root = el("div", parent, "", "field");
  let current = value;
  const f = mountTextField(root, {
    label,
    value,
    password,
    multiline,
    onChange: (v) => {
      current = v;
      f.update({ value: v });
    },
  });
  disposers.push(() => f.dispose());
  return () => current;
}
function select(
  parent: HTMLElement,
  label: string,
  options: { id: string; label: string }[],
  initial?: string,
) {
  el("label", parent, label);
  let value = initial ?? options[0]?.id ?? "";
  const root = el("div", parent, "", "field"),
    s = mountSelect(root, {
      options,
      value,
      onChange: (v) => {
        value = v;
        s.update({ value: v });
      },
    });
  disposers.push(() => s.dispose());
  return () => value;
}
async function request<T = unknown>(
  path: string,
  method: "GET" | "POST" | "PUT" = "GET",
  body?: unknown,
): Promise<T> {
  const r = await host.serviceRequest({
    method,
    path,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const value = JSON.parse(r.body);
  if (r.status >= 400) throw new Error(value.error || "Request failed");
  return value;
}
async function action(path: string, body?: unknown) {
  const r = await request(path, "POST", body);
  message.textContent = "Request accepted. Check Activity for completion.";
  return r;
}
async function render() {
  const g = ++generation;
  disposers.forEach((d) => d());
  disposers = [];
  main.replaceChildren();
  message.textContent = "";
  el(
    "h2",
    main,
    {
      environments: "Environments",
      deploy: "Quick deploy",
      clusters: "Kubernetes",
      credentials: "Credentials",
      activity: "Activity",
      settings: "Settings",
    }[tab] || tab,
  );
  try {
    if (tab === "environments") {
      const environments = await request<Environment[]>("/environments");
      if (g !== generation) return;
      button(main, "Refresh", render);
      if (!environments.length)
        el(
          "p",
          main,
          "Connect UpCloud in Credentials, then create an environment or import an existing machine.",
          "notice",
        );
      for (const env of environments) {
        const card = el("section", main, "", "card");
        el("span", card, env.zone, "tag");
        el("h3", card, env.name);
        el("p", card, env.id, "muted");
        el("p", card, `${env.plan} · ${env.host || "IP pending"}`);
        const row = el("div", card, "", "actions");
        for (const a of ["refresh", "start", "stop", "restart"])
          button(
            row,
            a,
            () => action(`/environments/${env.id}/${a}`),
            a === "stop",
          );
        button(row, "Connect", async () =>
          output(card, await action(`/environments/${env.id}/connect`)),
        );
        button(row, "Open app", () =>
          host.openUrl(`https://${env.id}.tirbox.site`),
        );
        const more = el("details", card);
        el("summary", more, "Deployment & configuration");
        button(more, "Create server API key", () =>
          action(`/environments/${env.id}/server-key`),
        );
        button(more, "Configure DNS", () =>
          action(`/environments/${env.id}/dns`),
        );
        const email = field(more, "Let’s Encrypt email"),
          port = field(more, "App localhost port", "3000");
        button(more, "Configure TLS", () =>
          action(`/environments/${env.id}/tls`, {
            email: email(),
            port: Number(port()),
          }),
        );
        const idle = field(
            more,
            "Idle minutes (0 disables)",
            String(env.idleMinutes),
          ),
          lifetime = field(more, "Lifetime minutes from now (0 disables)", "0");
        button(more, "Enroll controller", () =>
          action(`/environments/${env.id}/enroll`, {
            idleMinutes: Number(idle()),
            lifetimeMinutes: Number(lifetime()),
          }),
        );
        button(more, "Latest report", async () =>
          output(
            more,
            (await request<{ text: string }>(`/reports/${env.id}`)).text,
          ),
        );
        const repo = field(more, "GitHub repository", "owner/repository"),
          sha = field(more, "Full staging commit SHA"),
          install = field(more, "Install command", "npm ci"),
          build = field(more, "Build command", "npm run build"),
          test = field(more, "Test command", "npm test"),
          start = field(
            more,
            "Start/restart command",
            "systemctl --user restart sandboxer-app",
          );
        button(more, "Deploy & test", () =>
          action(`/environments/${env.id}/deploy`, {
            repo: repo(),
            sha: sha(),
            install: install(),
            build: build(),
            test: test(),
            start: start(),
          }),
        );
        const project = field(more, "Project folder for snapshot");
        button(more, "Save to R2", () =>
          action(`/environments/${env.id}/snapshot`, { project: project() }),
        );
      }
      const importBox = el("details", main);
      el("summary", importBox, "Existing UpCloud machines");
      button(importBox, "Load machines", async () => {
        const servers = await request<Server[]>("/servers");
        for (const server of servers) {
          const row = el("div", importBox, "", "card");
          el("p", row, `${server.title} · ${server.state} · ${server.zone}`);
          button(row, "Add to Sandboxer", async () => {
            await action("/environments/adopt", { serverId: server.uuid });
            await render();
          });
        }
      });
    }
    if (tab === "deploy") {
      const [plans, templates] = await Promise.all([
        request<Plan[]>("/plans"),
        request<Template[]>("/templates"),
      ]);
      if (g !== generation) return;
      el(
        "p",
        main,
        "Provision in NYC1 with a versioned cloud-init template. Credentials are never embedded in templates.",
        "muted",
      );
      const name = field(main, "Environment name", "My sandbox");
      const plan = select(
        main,
        "Machine",
        plans.map((p) => ({
          id: p.name,
          label: `${p.core_number} cores / ${Number(p.memory_amount) / 1024} GB — ${p.name}`,
        })),
      );
      const template = select(
        main,
        "Template",
        templates.map((t) => ({ id: t.id, label: `${t.name} · ${t.source}` })),
      );
      const image = field(main, "Ubuntu image UUID");
      button(main, "List available images", async () =>
        output(main, await request("/images")),
      );
      const key = field(main, "SSH public key");
      button(main, "Create environment", () =>
        action("/environments", {
          name: name(),
          plan: plan(),
          template: template(),
          image: image(),
          sshKey: key(),
        }),
      );
      for (const t of templates) {
        const d = el("details", main);
        el("summary", d, t.name);
        el("p", d, t.description);
        output(d, t.cloudInit);
      }
    }
    if (tab === "clusters") {
      const create = el("details", main);
      el("summary", create, "Create cluster");
      const name = field(create, "Cluster name"),
        network = field(create, "Network UUID in selected region"),
        cidr = field(create, "Network CIDR", "172.16.0.0/24"),
        region = field(create, "Region", "us-nyc1"),
        cp = field(create, "Control plane plan", "dev-md"),
        ips = field(create, "Allowed control plane CIDRs (comma separated)"),
        np = field(create, "Node plan", "2xCPU-4GB"),
        nc = field(create, "Node count", "1");
      button(create, "Available control plane plans", async () =>
        output(create, await request("/cluster-plans")),
      );
      button(create, "Create cluster", () =>
        action("/clusters", {
          name: name(),
          network: network(),
          network_cidr: cidr(),
          zone: region(),
          plan: cp(),
          control_plane_ip_filter: ips()
            .split(",")
            .map((v) => v.trim()),
          node_groups: [{ name: "workers", count: Number(nc()), plan: np() }],
        }),
      );
      const rows =
        await request<
          Array<{ uuid: string; name: string; state: string; zone: string }>
        >("/clusters");
      if (g !== generation) return;
      if (!rows.length) el("p", main, "No clusters in this account.");
      for (const c of rows) {
        const card = el("section", main, "", "card");
        el("h3", card, c.name);
        el("p", card, `${c.zone} · ${c.state}`);
        button(card, "Workloads", async () =>
          output(card, await request(`/clusters/${c.uuid}/workloads`)),
        );
        button(card, "Node groups", async () =>
          output(card, await request(`/clusters/${c.uuid}/nodes`)),
        );
        const d = el("details", card);
        el("summary", d, "Manage cluster");
        const group = field(d, "Node group"),
          count = field(d, "Node count", "1");
        button(d, "Scale node group", () =>
          action(`/clusters/${c.uuid}/scale`, {
            group: group(),
            count: Number(count()),
          }),
        );
        const ns = field(d, "Namespace", "default"),
          pod = field(d, "Pod");
        button(d, "Read logs", async () =>
          output(
            d,
            await request(`/clusters/${c.uuid}/logs`, "POST", {
              namespace: ns(),
              pod: pod(),
            }),
          ),
        );
        const deployment = field(d, "Deployment");
        button(d, "Restart deployment", () =>
          action(`/clusters/${c.uuid}/restart`, {
            namespace: ns(),
            deployment: deployment(),
          }),
        );
        const yaml = field(d, "Application manifest", "", false, true);
        button(d, "Apply manifest", () =>
          action(`/clusters/${c.uuid}/apply`, { yaml: yaml() }),
        );
        const version = field(d, "Kubernetes version");
        button(d, "Rolling upgrade", () =>
          action(`/clusters/${c.uuid}/upgrade`, { version: version() }),
        );
      }
    }
    if (tab === "credentials") {
      const rows =
        await request<Array<{ id: string; kind: string; label: string }>>(
          "/credentials",
        );
      if (g !== generation) return;
      el(
        "p",
        main,
        "Encrypted on this machine. macOS uses Keychain for the encryption key. Saved values are never returned to this panel.",
        "muted",
      );
      for (const row of rows)
        el("div", main, `${row.label} · ${row.id}`, "card");
      const id = field(main, "Credential ID", "upcloud"),
        kind = select(
          main,
          "Type",
          [
            "upcloud",
            "cloudflare",
            "r2",
            "github",
            "model",
            "controller",
            "custom",
          ].map((id) => ({ id, label: id })),
        ),
        label = field(main, "Label", "UpCloud management"),
        value = field(main, "Secret value", "", true);
      el(
        "p",
        main,
        "Reserved IDs: upcloud, cloudflare, r2, controller. R2 value: JSON with accessKeyId and secretAccessKey.",
        "notice",
      );
      button(main, "Save credential", async () => {
        await request("/credentials", "POST", {
          id: id(),
          kind: kind(),
          label: label(),
          value: value(),
        });
        await render();
      });
    }
    if (tab === "activity") {
      const [jobs, audit] = await Promise.all([
        request("/jobs"),
        request("/audit"),
      ]);
      if (g !== generation) return;
      button(main, "Refresh", render);
      el("h3", main, "Jobs");
      output(main, jobs);
      el("h3", main, "Action log");
      output(main, audit);
    }
    if (tab === "settings") {
      const s = await request<Settings>("/settings");
      if (g !== generation) return;
      const zone = field(main, "UpCloud region", s.zone),
        idle = field(
          main,
          "Default idle timeout (minutes; 0 disables)",
          String(s.idleMinutes),
        ),
        vault = field(
          main,
          "Obsidian template folder (absolute path)",
          s.vaultPath,
        ),
        controller = field(main, "Cloudflare controller URL", s.controllerUrl),
        cfZone = field(
          main,
          "Cloudflare zone ID for tirbox.site",
          s.cloudflareZoneId,
        ),
        account = field(main, "R2 account ID", s.r2AccountId),
        bucket = field(main, "R2 workspace bucket", s.r2Bucket);
      el(
        "p",
        main,
        "Domain: <environment-id>.tirbox.site. Idle shutdown requires an enrolled controller and live activity heartbeats; saving this default alone does not enable it.",
        "notice",
      );
      button(main, "Save settings", async () => {
        await request("/settings", "PUT", {
          ...s,
          zone: zone(),
          idleMinutes: Number(idle()),
          vaultPath: vault(),
          controllerUrl: controller(),
          cloudflareZoneId: cfZone(),
          r2AccountId: account(),
          r2Bucket: bucket(),
        });
        message.textContent = "Settings saved.";
      });
    }
  } catch (e) {
    if (g === generation)
      el(
        "p",
        main,
        e instanceof Error ? e.message : "Could not load",
        "notice",
      );
  }
  el("footer", main, "Sandboxer · private preview");
}
host.onReady((ctx) => {
  applyHostReady(ctx, document.documentElement);
  if (mounted) return;
  mounted = true;
  const tabs = mountTabs(document.querySelector<HTMLElement>("#tabs")!, {
    items: [
      { id: "environments", label: "Machines" },
      { id: "deploy", label: "Deploy" },
      { id: "clusters", label: "Kubernetes" },
      { id: "credentials", label: "Keys" },
      { id: "activity", label: "Activity" },
      { id: "settings", label: "Settings" },
    ],
    activeId: tab,
    onChange: (id) => {
      tab = id;
      tabs.update({ activeId: id });
      void render();
    },
  });
  void render();
});
