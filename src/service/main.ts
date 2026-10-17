import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { api } from "./api";
const token = process.env.OPENCHAMBER_SERVICE_TOKEN;
if (!token)
  throw new Error(
    "Launch from OpenChamber, or supply OPENCHAMBER_SERVICE_TOKEN and OPENCHAMBER_SERVICE_PORT for development",
  );
const expected = Buffer.from(`Bearer ${token}`);
createServer(async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  const supplied = Buffer.from(req.headers.authorization || "");
  if (
    supplied.length !== expected.length ||
    !timingSafeEqual(supplied, expected)
  ) {
    res.writeHead(401);
    res.end('{"error":"Unauthorized"}');
    return;
  }
  try {
    let raw = "";
    for await (const chunk of req) {
      raw += chunk;
      if (Buffer.byteLength(raw) > 256000) {
        res.writeHead(413);
        res.end('{"error":"Request too large"}');
        return;
      }
    }
    const value = await api(
      req.method || "GET",
      new URL(req.url || "/", "http://localhost").pathname,
      raw ? JSON.parse(raw) : undefined,
    );
    res.end(JSON.stringify(value));
  } catch (e) {
    res.writeHead(400);
    res.end(
      JSON.stringify({
        error: e instanceof Error ? e.message : "Operation failed",
      }),
    );
  }
}).listen(Number(process.env.OPENCHAMBER_SERVICE_PORT || 47381), "127.0.0.1");
