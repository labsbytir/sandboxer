// plugins/openclaw/src/index.ts
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { Type } from "typebox";

// plugins/openclaw/routes.json
var routes_default = {
  read: "^/(health|environments|servers|plans|images|templates|jobs|audit|controller|clusters|cluster-plans|reports/env-[a-f0-9]{16}|clusters/[a-f0-9-]{36}/(nodes|workloads))$",
  action: "^/(environments|environments/adopt|clusters|environments/env-[a-f0-9]{16}/(start|stop|restart|connect|deploy|refresh|server-key|dns|snapshot|enroll|tls)|clusters/[a-f0-9-]{36}/(logs|restart|scale|apply|upgrade|add-nodes))$"
};

// plugins/openclaw/src/client.ts
async function request(kind, args) {
  if (typeof args.path !== "string" || !new RegExp(routes_default[kind]).test(args.path))
    throw new Error("Unsupported Sandboxer path");
  const port = process.env.SANDBOXER_SERVICE_PORT || "47381";
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535)
    throw new Error("Invalid SANDBOXER_SERVICE_PORT");
  const token = process.env.SANDBOXER_SERVICE_TOKEN;
  if (!token)
    throw new Error("Set SANDBOXER_SERVICE_TOKEN in the host environment");
  const body = kind === "action" ? JSON.stringify(args.body ?? {}) : void 0;
  if (body && Buffer.byteLength(body) > 256 * 1024)
    throw new Error("Request too large");
  const response = await fetch(`http://127.0.0.1:${port}${args.path}`, {
    method: kind === "read" ? "GET" : "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body,
    redirect: "error",
    signal: AbortSignal.timeout(3e4)
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(
      `Sandboxer request failed (${response.status}); check service configuration and job logs`
    );
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 2 * 1024 * 1024) throw new Error("Response too large");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

// plugins/openclaw/src/index.ts
var index_default = definePluginEntry({
  id: "sandboxer",
  name: "Sandboxer",
  description: "Cloud environments, deployments, Kubernetes and performance reports",
  register(api) {
    for (const kind of ["read", "action"]) {
      api.registerTool(
        {
          name: `sandboxer_${kind}`,
          description: kind === "read" ? "Read Sandboxer /environments, /servers, /plans, /images, /templates, /jobs, /audit, /controller, /clusters, /cluster-plans, /reports/{environmentId}, /clusters/{uuid}/nodes or workloads." : "Perform a Sandboxer operation. POST /environments (name, plan, image UUID, template, sshKey); /environments/adopt (serverId); /environments/{id}/{start|stop|restart|connect|refresh|dns|server-key|deploy|snapshot|enroll|tls}; /clusters or /clusters/{uuid}/{logs|restart|scale|apply|upgrade|add-nodes}. Deploy body: repo, full staging sha, install, build, test, start. Snapshot: project. Enroll: idleMinutes, lifetimeMinutes. TLS: email, port. Cluster logs: namespace, pod; restart: namespace, deployment; scale: group, count; apply: yaml; upgrade: version. Returns queued jobs: inspect /jobs for completion. Actions can incur charges or interrupt workloads.",
          parameters: Type.Object(
            {
              path: Type.String({ pattern: routes_default[kind] }),
              ...kind === "action" ? {
                body: Type.Optional(
                  Type.Object({}, { additionalProperties: true })
                )
              } : {}
            },
            { additionalProperties: false }
          ),
          async execute(_id, params) {
            try {
              const details = await request(kind, params);
              return {
                content: [{ type: "text", text: JSON.stringify(details) }],
                details
              };
            } catch (error) {
              const message = error instanceof Error && !["TypeError", "AbortError", "TimeoutError"].includes(
                error.name
              ) ? error.message : "Sandboxer service unavailable";
              return {
                isError: true,
                content: [{ type: "text", text: message }]
              };
            }
          }
        },
        { optional: kind === "action", workspaceAccess: false }
      );
    }
  }
});
export {
  index_default as default
};
