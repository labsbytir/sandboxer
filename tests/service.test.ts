import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import {
  templates,
  renderCloudInit,
  parseTemplate,
} from "../src/service/templates";
import { UpCloud } from "../src/providers/upcloud";

test("cloud-init carries identity and public SSH key, with a real bootstrap", async () => {
  const [template] = await templates();
  const doc = parse(
    renderCloudInit(template, "env-0123456789abcdef", "ssh-ed25519 AAAA"),
  );
  assert.equal(doc.ssh_pwauth, false);
  assert.equal(doc.hostname, "env-0123456789abcdef");
  assert.deepEqual(doc.users[0].ssh_authorized_keys, ["ssh-ed25519 AAAA"]);
  assert.ok(
    doc.write_files.some(
      (f: { path: string }) => f.path === "/opt/sandboxer/collector.py",
    ),
  );
  assert.throws(() =>
    parseTemplate("---\nid: x\n---\n```cloud-init\n[]\n```", "test"),
  );
});
test("provider authenticates to the fixed UpCloud origin and redacts API failures", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fake: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    return Response.json({ servers: { server: [] } });
  };
  assert.deepEqual(await new UpCloud("test-secret", fake).listServers(), []);
  assert.equal(calls[0].url, "https://api.upcloud.com/1.3/server");
  assert.equal(
    new Headers(calls[0].init?.headers).get("Authorization"),
    "Bearer test-secret",
  );
  const failure: typeof fetch = async () =>
    new Response("secret material", { status: 403 });
  await assert.rejects(
    new UpCloud("secret", failure).listServers(),
    (e) => e instanceof Error && !e.message.includes("secret material"),
  );
});
test("credential vault encrypts at rest and detects tampering", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sandboxer-test-"));
  process.env.SANDBOXER_DATA_DIR = dir;
  process.env.SANDBOXER_MASTER_KEY = "ab".repeat(32);
  try {
    const store = await import("../src/service/store");
    await store.putCredential(
      "example",
      "custom",
      "Example",
      "never-store-plaintext",
    );
    assert.equal(await store.secret("example"), "never-store-plaintext");
    assert.ok(
      !(await readFile(join(dir, "credentials.json"), "utf8")).includes(
        "never-store-plaintext",
      ),
    );
    const rows = await store.credentials();
    rows[0].tag = Buffer.alloc(16).toString("base64");
    await store.saveJSON("credentials.json", rows);
    await assert.rejects(store.secret("example"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
