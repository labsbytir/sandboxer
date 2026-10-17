import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request } from "../plugins/openclaw/src/client";

function listen(server: Server) {
  return new Promise<number>((resolve, reject) => {
    server.listen(0, "127.0.0.1", () =>
      resolve((server.address() as AddressInfo).port),
    );
    server.once("error", reject);
  });
}

test("OpenClaw client authenticates, bounds and restricts paths", async () => {
  const server = createServer((req, res) => {
    if (req.headers.authorization !== "Bearer local-test-token") {
      res.writeHead(401).end();
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, path: req.url, method: req.method }));
  });
  const port = await listen(server);
  const previousPort = process.env.SANDBOXER_SERVICE_PORT;
  const previousToken = process.env.SANDBOXER_SERVICE_TOKEN;
  process.env.SANDBOXER_SERVICE_PORT = String(port);
  process.env.SANDBOXER_SERVICE_TOKEN = "local-test-token";
  try {
    assert.deepEqual(await request("read", { path: "/environments" }), {
      ok: true,
      path: "/environments",
      method: "GET",
    });
    assert.deepEqual(
      await request("action", {
        path: "/environments/env-0123456789abcdef/start",
        body: {},
      }),
      {
        ok: true,
        path: "/environments/env-0123456789abcdef/start",
        method: "POST",
      },
    );
    await assert.rejects(
      request("read", { path: "/settings" }),
      /Unsupported Sandboxer path/,
    );
    await assert.rejects(
      request("action", { path: "/credentials", body: {} }),
      /Unsupported Sandboxer path/,
    );
    process.env.SANDBOXER_SERVICE_TOKEN = "wrong";
    await assert.rejects(
      request("read", { path: "/environments" }),
      /failed \(401\)/,
    );
  } finally {
    if (previousPort === undefined) delete process.env.SANDBOXER_SERVICE_PORT;
    else process.env.SANDBOXER_SERVICE_PORT = previousPort;
    if (previousToken === undefined) delete process.env.SANDBOXER_SERVICE_TOKEN;
    else process.env.SANDBOXER_SERVICE_TOKEN = previousToken;
    server.close();
  }
});

test("Hermes plugin registers and handles authenticated tool calls", async () => {
  const temp = await mkdtemp(join(tmpdir(), "sandboxer-hermes-"));
  const plugin = join(temp, "sandboxer");
  execFileSync("cp", ["-R", "plugins/hermes", plugin]);
  const script = `
import importlib.util, json, os, threading
from http.server import BaseHTTPRequestHandler, HTTPServer
class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(b'{"environments": []}')
    def log_message(self, *args):
        pass
server = HTTPServer(("127.0.0.1", 0), Handler)
threading.Thread(target=server.serve_forever, daemon=True).start()
os.environ["SANDBOXER_SERVICE_PORT"] = str(server.server_port)
os.environ["SANDBOXER_SERVICE_TOKEN"] = "python-test-token"
path = os.path.join(${JSON.stringify(plugin)}, "__init__.py")
spec = importlib.util.spec_from_file_location("sandboxer_plugin", path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
registered = []
class Ctx:
    def register_tool(self, **kwargs):
        registered.append(kwargs)
module.register(Ctx())
assert [x["name"] for x in registered] == ["sandboxer_read", "sandboxer_action"]
assert registered[0]["handler"]({"path": "/environments"}) == json.dumps({"environments": []})
assert "Invalid Sandboxer request" in registered[1]["handler"]({"path": "/settings"})
assert "Invalid Sandboxer request" in registered[0]["handler"]({"path": "/credentials"})
server.shutdown()
print("ok")
`;
  try {
    const result = execFileSync("python3", ["-c", script], {
      encoding: "utf8",
    });
    assert.equal(result.trim(), "ok");
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("OpenClaw plugin package build declares and bundles its tools", async () => {
  const built = await readFile("plugins/openclaw/dist/index.js", "utf8");
  assert.match(built, /sandboxer_/);
  assert.match(built, /registerTool/);
  assert.match(built, /environments\/env-\[a-f0-9\]\{16\}/);
  const manifest = JSON.parse(
    await readFile("plugins/openclaw/openclaw.plugin.json", "utf8"),
  );
  assert.deepEqual(manifest.contracts.tools, [
    "sandboxer_read",
    "sandboxer_action",
  ]);
  assert.equal(manifest.toolMetadata.sandboxer_action.optional, true);
});
