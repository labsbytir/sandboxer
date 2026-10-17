import { z } from "zod";
import { shouldStop, environmentId } from "../core/contracts";
type Secrets = {
  CONTROLLER_TOKEN: string;
  UPCLOUD_TOKEN: string;
  BASIN_TOKEN: string;
  PIPELINE_TOKEN?: string;
};
type WorkerEnv = Cloudflare.Env & Secrets;
type Row = {
  id: string;
  server_id: string;
  token_hash: string;
  idle_minutes: number;
  last_seen: number;
  last_activity: number;
  active_jobs: number;
  active_connections: number;
  stop_at: number | null;
  stop_claim: number;
  stopped: number;
};
async function hash(value: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
  )
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
async function authenticated(req: Request, expected: string) {
  if (!expected) return false;
  return (
    (await hash(req.headers.get("Authorization") || "")) ===
    (await hash("Bearer " + expected))
  );
}
async function record(
  env: WorkerEnv,
  id: string,
  action: string,
  status: string,
) {
  await env.DB.prepare("INSERT INTO audit VALUES (?,?,?,?,?)")
    .bind(crypto.randomUUID(), new Date().toISOString(), id, action, status)
    .run();
  console.log(JSON.stringify({ environment_id: id, action, status }));
}
async function jsonBody(req: Request) {
  const reader = req.body?.getReader();
  if (!reader) throw new Error("Missing body");
  let length = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > 256000) {
      await reader.cancel();
      throw new Error("Body too large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}
export async function report(env: WorkerEnv, id: string, now: number) {
  environmentId.parse(id);
  if (!/^[a-zA-Z_][\w]*\.[a-zA-Z_][\w]*$/.test(env.BASIN_TABLE))
    throw new Error("Invalid table");
  const from = new Date(now - 15 * 60_000).toISOString(),
    to = new Date(now).toISOString();
  const query = `SELECT COUNT(*) AS samples, MAX(timestamp) AS latest_event, AVG(cpu_load) AS average_load, MAX(memory_used_pct) AS peak_memory_pct, MAX(disk_used_pct) AS peak_disk_pct FROM ${env.BASIN_TABLE} WHERE environment_id = '${id}' AND timestamp >= '${from}' AND timestamp < '${to}'`;
  const response = await fetch(
    `https://api.sql.cloudflarestorage.com/api/v1/accounts/${env.ACCOUNT_ID}/basin-sql/query/${encodeURIComponent(env.BASIN_BUCKET)}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.BASIN_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(30000),
    },
  );
  if (!response.ok) throw new Error("Basin query failed");
  const result = (await response.json()) as {
    success: boolean;
    result?: {
      rows: Record<string, unknown>[];
      metrics?: { bytes_scanned?: number };
    };
  };
  if (!result.success || !result.result) throw new Error("Basin query failed");
  const row = result.result.rows[0] || {};
  const markdown = `# ${id} performance\n\nGenerated: ${to}\n\nWindow: ${from} → ${to} (15-minute overlap for ingestion delay).\n\n${Object.entries(
    row,
  )
    .map(([k, v]) => `- **${k}**: ${String(v ?? "No data")}`)
    .join(
      "\n",
    )}\n\nBytes scanned: ${result.result.metrics?.bytes_scanned ?? "unknown"}\n\nMissing or delayed samples are not evidence of a healthy server.\n`;
  await env.REPORTS.put(`${id}/${to.replaceAll(":", "-")}.md`, markdown, {
    httpMetadata: { contentType: "text/markdown" },
  });
  await env.REPORTS.put(`${id}/latest.md`, markdown, {
    httpMetadata: { contentType: "text/markdown" },
  });
}
export default {
  async fetch(req: Request, env: WorkerEnv): Promise<Response> {
    try {
      const url = new URL(req.url);
      const heartbeat = url.pathname.match(
        /^\/environments\/(env-[a-f0-9]{16})\/(heartbeat|telemetry)$/,
      );
      if (heartbeat && req.method === "POST") {
        const row = await env.DB.prepare(
          "SELECT * FROM environments WHERE id=?",
        )
          .bind(heartbeat[1])
          .first<Row>();
        const auth = req.headers.get("Authorization") || "";
        if (
          !row ||
          !auth.startsWith("Bearer ") ||
          (await hash(auth.slice(7))) !== row.token_hash
        )
          return new Response("Unauthorized", { status: 401 });
        const body = await jsonBody(req),
          now = Date.now();
        if (heartbeat[2] === "heartbeat") {
          const b = z
            .object({
              activeJobs: z.number().int().min(0).max(10000),
              activeConnections: z.number().int().min(0).max(10000),
              active: z.boolean(),
            })
            .parse(body);
          await env.DB.prepare(
            "UPDATE environments SET last_seen=?,last_activity=CASE WHEN ? THEN ? ELSE last_activity END, active_jobs=?,active_connections=?,stopped=0 WHERE id=?",
          )
            .bind(
              now,
              b.active || b.activeJobs > 0 || b.activeConnections > 0 ? 1 : 0,
              now,
              b.activeJobs,
              b.activeConnections,
              row.id,
            )
            .run();
        } else {
          const events = z
            .array(
              z.object({
                timestamp: z.iso.datetime(),
                kind: z.string().max(40),
                run_id: z.string().max(128).optional(),
                message: z.string().max(8000).optional(),
                cpu_load: z.number().optional(),
                memory_used_pct: z.number().min(0).max(100).optional(),
                disk_used_pct: z.number().min(0).max(100).optional(),
              }),
            )
            .max(100)
            .parse(body);
          if (!env.PIPELINE_URL.startsWith("https://"))
            throw new Error("Pipeline not configured");
          const response = await fetch(env.PIPELINE_URL, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(env.PIPELINE_TOKEN
                ? { Authorization: `Bearer ${env.PIPELINE_TOKEN}` }
                : {}),
            },
            body: JSON.stringify(
              events.map((e) => ({ ...e, environment_id: row.id })),
            ),
            signal: AbortSignal.timeout(15000),
          });
          if (!response.ok) throw new Error("Pipeline ingestion failed");
        }
        return Response.json({ ok: true });
      }
      if (!(await authenticated(req, env.CONTROLLER_TOKEN)))
        return new Response("Unauthorized", { status: 401 });
      if (url.pathname === "/environments" && req.method === "POST") {
        const b = z
          .object({
            id: environmentId,
            serverId: z.uuid(),
            idleMinutes: z.number().int().min(0).max(10080),
            stopAt: z.number().int().positive().optional(),
          })
          .parse(await jsonBody(req));
        const token = crypto.randomUUID() + crypto.randomUUID();
        await env.DB.prepare(
          "INSERT INTO environments (id,server_id,token_hash,idle_minutes,last_activity,stop_at) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET token_hash=excluded.token_hash,idle_minutes=excluded.idle_minutes,stop_at=excluded.stop_at",
        )
          .bind(
            b.id,
            b.serverId,
            await hash(token),
            b.idleMinutes,
            Date.now(),
            b.stopAt ?? null,
          )
          .run();
        await record(env, b.id, "enroll", "succeeded");
        return Response.json({ token });
      }
      if (url.pathname === "/environments" && req.method === "GET")
        return Response.json(
          (
            await env.DB.prepare(
              "SELECT id,server_id,idle_minutes,last_seen,last_activity,active_jobs,active_connections,stopped FROM environments",
            ).all()
          ).results,
        );
      if (url.pathname === "/audit" && req.method === "GET")
        return Response.json(
          (
            await env.DB.prepare(
              "SELECT * FROM audit ORDER BY timestamp DESC LIMIT 100",
            ).all()
          ).results,
        );
      const match = url.pathname.match(/^\/reports\/(env-[a-f0-9]{16})$/);
      if (match && req.method === "GET") {
        const obj = await env.REPORTS.get(match[1] + "/latest.md");
        return obj
          ? new Response(obj.body, {
              headers: {
                "Content-Type": "text/markdown",
                "Cache-Control": "no-store",
              },
            })
          : new Response("No report yet", { status: 404 });
      }
      return new Response("Not found", { status: 404 });
    } catch (e) {
      console.error(
        JSON.stringify({
          action: "request",
          status: "failed",
          type: e instanceof Error ? e.name : "error",
        }),
      );
      return Response.json(
        { error: "Operation failed; check configuration and controller logs" },
        { status: 400 },
      );
    }
  },
  async scheduled(event: ScheduledController, env: WorkerEnv) {
    const now = event.scheduledTime;
    const rows = (await env.DB.prepare("SELECT * FROM environments").all<Row>())
      .results;
    for (const row of rows) {
      if (
        !row.stopped &&
        shouldStop(
          {
            lastSeen: row.last_seen,
            lastActivity: row.last_activity,
            activeJobs: row.active_jobs,
            activeConnections: row.active_connections,
            idleMinutes: row.idle_minutes,
            stopAt: row.stop_at ?? undefined,
          },
          now,
        )
      ) {
        const claim = await env.DB.prepare(
          "UPDATE environments SET stop_claim=? WHERE id=? AND stop_claim<? AND last_seen=? AND last_activity=?",
        )
          .bind(now, row.id, now - 600000, row.last_seen, row.last_activity)
          .run();
        if (claim.meta.changes) {
          try {
            const r = await fetch(
              `https://api.upcloud.com/1.3/server/${row.server_id}/stop`,
              {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${env.UPCLOUD_TOKEN}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  stop_server: { stop_type: "soft", timeout: 120 },
                }),
                signal: AbortSignal.timeout(15000),
              },
            );
            if (!r.ok) throw new Error("Stop failed");
            await env.DB.prepare(
              "UPDATE environments SET stopped=1,stop_at=NULL WHERE id=?",
            )
              .bind(row.id)
              .run();
            await record(env, row.id, "auto-stop", "accepted");
          } catch {
            await record(env, row.id, "auto-stop", "failed");
          }
        }
      }
      if (row.last_seen > now - 900000) {
        try {
          await report(env, row.id, now);
        } catch {
          await record(env, row.id, "report", "failed");
        }
      }
    }
  },
} satisfies ExportedHandler<WorkerEnv>;
