import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { Type } from "typebox";
import { request } from "./client";
import routes from "../routes.json";

export default definePluginEntry({
  id: "sandboxer",
  name: "Sandboxer",
  description:
    "Cloud environments, deployments, Kubernetes and performance reports",
  register(api) {
    for (const kind of ["read", "action"] as const) {
      api.registerTool(
        {
          name: `sandboxer_${kind}`,
          description:
            kind === "read"
              ? "Read Sandboxer /environments, /servers, /plans, /images, /templates, /jobs, /audit, /controller, /clusters, /cluster-plans, /reports/{environmentId}, /clusters/{uuid}/nodes or workloads."
              : "Perform a Sandboxer operation. POST /environments (name, plan, image UUID, template, sshKey); /environments/adopt (serverId); /environments/{id}/{start|stop|restart|connect|refresh|dns|server-key|deploy|snapshot|enroll|tls}; /clusters or /clusters/{uuid}/{logs|restart|scale|apply|upgrade|add-nodes}. Deploy body: repo, full staging sha, install, build, test, start. Snapshot: project. Enroll: idleMinutes, lifetimeMinutes. TLS: email, port. Cluster logs: namespace, pod; restart: namespace, deployment; scale: group, count; apply: yaml; upgrade: version. Returns queued jobs: inspect /jobs for completion. Actions can incur charges or interrupt workloads.",
          parameters: Type.Object(
            {
              path: Type.String({ pattern: routes[kind] }),
              ...(kind === "action"
                ? {
                    body: Type.Optional(
                      Type.Object({}, { additionalProperties: true }),
                    ),
                  }
                : {}),
            },
            { additionalProperties: false },
          ),
          async execute(_id, params) {
            try {
              const details = await request(kind, params);
              return {
                content: [{ type: "text", text: JSON.stringify(details) }],
                details,
              };
            } catch (error) {
              // Network errors can include request details; do not expose nested causes.
              const message =
                error instanceof Error &&
                !["TypeError", "AbortError", "TimeoutError"].includes(
                  error.name,
                )
                  ? error.message
                  : "Sandboxer service unavailable";
              return {
                isError: true,
                content: [{ type: "text", text: message }],
              };
            }
          },
        },
        { optional: kind === "action", workspaceAccess: false },
      );
    }
  },
});
