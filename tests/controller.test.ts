import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { z } from "zod";

test("controller enrollment isolates environment tokens and records activity in D1", async () => {
  const bundle = await build({
    entryPoints: ["src/worker/index.ts"],
    bundle: true,
    format: "esm",
    platform: "browser",
    write: false,
  });
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      workers: [
        {
          name: "controller",
          modules: true,
          script: bundle.outputFiles[0].text,
          compatibilityDate: "2026-10-17",
          d1Databases: ["DB"],
          r2Buckets: ["REPORTS"],
          bindings: {
            CONTROLLER_TOKEN: "administrator-test",
            UPCLOUD_TOKEN: "unused",
            BASIN_TOKEN: "unused",
            ACCOUNT_ID: "unused",
            BASIN_BUCKET: "unused",
            BASIN_TABLE: "default.telemetry",
            PIPELINE_URL: "",
          },
        },
      ],
    }),
  );
  try {
    const db = await mf.getD1Database("DB");
    const sql = await readFile(
      "src/worker/migrations/0001_initial.sql",
      "utf8",
    );
    for (const statement of sql.split(";").filter((v) => v.trim()))
      await db.prepare(statement).run();
    const request = (path: string, token: string, body?: unknown) =>
      mf.dispatchFetch("https://controller.test" + path, {
        method: body ? "POST" : "GET",
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "application/json",
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    assert.equal((await request("/environments", "wrong")).status, 401);
    const id = "env-0123456789abcdef";
    const enrolled = await request("/environments", "administrator-test", {
      id,
      serverId: "12345678-1234-4234-8234-123456789012",
      idleMinutes: 30,
    });
    assert.equal(enrolled.status, 200);
    const { token } = z
      .object({ token: z.string() })
      .parse(await enrolled.json());
    assert.equal(
      (
        await request(`/environments/${id}/heartbeat`, "wrong", {
          activeJobs: 0,
          activeConnections: 0,
          active: false,
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await request(`/environments/${id}/heartbeat`, token, {
          activeJobs: 1,
          activeConnections: 2,
          active: true,
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await request(`/environments/env-aaaaaaaaaaaaaaaa/heartbeat`, token, {
          activeJobs: 0,
          activeConnections: 0,
          active: false,
        })
      ).status,
      401,
    );
    assert.equal((await request("/environments", token)).status, 401);
    const row = await db
      .prepare("SELECT * FROM environments WHERE id=?")
      .bind(id)
      .first();
    assert.equal(row?.active_jobs, 1);
    assert.equal(row?.active_connections, 2);
    assert.notEqual(row?.token_hash, token);
    assert.equal(
      (await request(`/reports/${id}`, "administrator-test")).status,
      404,
    );
  } finally {
    await mf.dispose();
  }
});
