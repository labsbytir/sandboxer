import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";

test("packaged companion authenticates requests and serves bundled templates", async () => {
  const socket = createServer().listen(0, "127.0.0.1");
  await once(socket, "listening");
  const address = socket.address();
  assert.ok(address && typeof address === "object");
  const port = address.port;
  await new Promise<void>((resolve) => socket.close(() => resolve()));
  const dir = await mkdtemp(join(tmpdir(), "sandboxer-http-"));
  const child = spawn(process.execPath, ["service/main.cjs"], {
    env: {
      ...process.env,
      SANDBOXER_DATA_DIR: dir,
      SANDBOXER_MASTER_KEY: "12".repeat(32),
      OPENCHAMBER_SERVICE_PORT: String(port),
      OPENCHAMBER_SERVICE_TOKEN: "test-only-token",
    },
    stdio: "ignore",
  });
  const base = `http://127.0.0.1:${port}`;
  const headers = {
    Authorization: "Bearer test-only-token",
    "Content-Type": "application/json",
  };
  try {
    let ready = false;
    for (let attempt = 0; attempt < 40; attempt++) {
      try {
        ready = (await fetch(base + "/health", { headers })).ok;
      } catch {}
      if (ready) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(ready, true);
    assert.equal((await fetch(base + "/health")).status, 401);
    const templates = await (
      await fetch(base + "/templates", { headers })
    ).json();
    assert.equal(templates[0].id, "ubuntu-development");
    const save = await fetch(base + "/credentials", {
      method: "POST",
      headers,
      body: JSON.stringify({
        id: "sample",
        kind: "custom",
        label: "Sample",
        value: "secret-value",
      }),
    });
    assert.equal(save.status, 200);
    const listed = await (
      await fetch(base + "/credentials", { headers })
    ).text();
    assert.ok(listed.includes("Sample"));
    assert.ok(
      !listed.includes("secret-value") && !listed.includes("ciphertext"),
    );
    assert.equal(
      (
        await fetch(base + "/settings", {
          method: "PUT",
          headers,
          body: '{"idleMinutes":-1}',
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await fetch(base + "/settings", {
          method: "PUT",
          headers,
          body: "x".repeat(256001),
        })
      ).status,
      413,
    );
  } finally {
    const exited = once(child, "exit");
    child.kill();
    await exited;
    await rm(dir, { recursive: true, force: true });
  }
});
