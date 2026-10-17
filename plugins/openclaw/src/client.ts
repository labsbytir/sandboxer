import routes from "../routes.json";

export async function request(
  kind: "read" | "action",
  args: { path: string; body?: unknown },
) {
  if (
    typeof args.path !== "string" ||
    !new RegExp(routes[kind]).test(args.path)
  )
    throw new Error("Unsupported Sandboxer path");
  const port = process.env.SANDBOXER_SERVICE_PORT || "47381";
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535)
    throw new Error("Invalid SANDBOXER_SERVICE_PORT");
  const token = process.env.SANDBOXER_SERVICE_TOKEN;
  if (!token)
    throw new Error("Set SANDBOXER_SERVICE_TOKEN in the host environment");
  const body = kind === "action" ? JSON.stringify(args.body ?? {}) : undefined;
  if (body && Buffer.byteLength(body) > 256 * 1024)
    throw new Error("Request too large");
  const response = await fetch(`http://127.0.0.1:${port}${args.path}`, {
    method: kind === "read" ? "GET" : "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body,
    redirect: "error",
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(
      `Sandboxer request failed (${response.status}); check service configuration and job logs`,
    );
  }
  const reader = response.body!.getReader();
  const chunks: Uint8Array[] = [];
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
