import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import { execute } from "./jobs";
import type { UpCloud } from "../providers/upcloud";
export async function kubectl(
  provider: UpCloud,
  id: string,
  args: string[],
  input = "",
) {
  const result = (await provider.cluster(id, "/kubeconfig")) as {
    kubeconfig: string;
  };
  const config = parse(result.kubeconfig);
  if (
    config.users?.some(
      (u: { user?: { exec?: unknown; "auth-provider"?: unknown } }) =>
        u.user?.exec || u.user?.["auth-provider"],
    )
  )
    throw new Error("Executable kubeconfig authentication is not supported");
  const dir = await mkdtemp(join(tmpdir(), "sandboxer-kube-"));
  const path = join(dir, "config");
  try {
    await writeFile(path, result.kubeconfig, { mode: 0o600 });
    return await execute(
      "kubectl",
      ["--kubeconfig", path, "--request-timeout=20s", ...args],
      input,
      60_000,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
