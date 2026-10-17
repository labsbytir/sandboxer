import {
  mkdir,
  readFile,
  writeFile,
  rename,
  appendFile,
  stat,
  readdir,
} from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import {
  randomUUID,
  randomBytes,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
export const dataDir =
  process.env.SANDBOXER_DATA_DIR || join(homedir(), ".config", "sandboxer");
export async function readJSON<T>(name: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(join(dataDir, name), "utf8"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw e;
  }
}
export async function saveJSON(name: string, value: unknown) {
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const p = join(dataDir, name),
    tmp = p + "." + randomUUID();
  await writeFile(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
  await rename(tmp, p);
}
let queue: Promise<unknown> = Promise.resolve();
export function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.then(fn, fn);
  queue = next.catch(() => {});
  return next;
}
export async function audit(action: string, target: string, status: string) {
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const p = join(dataDir, "actions.jsonl");
  try {
    if ((await stat(p)).size > 5_000_000)
      await rename(p, join(dataDir, `actions-${Date.now()}.jsonl`));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  await appendFile(
    p,
    JSON.stringify({
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      action,
      target,
      status,
    }) + "\n",
    { mode: 0o600 },
  );
}
export async function readAudit() {
  try {
    return (await readFile(join(dataDir, "actions.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .slice(-100)
      .map((l) => JSON.parse(l));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
}
export interface Credential {
  id: string;
  kind: string;
  label: string;
  ciphertext: string;
  iv: string;
  tag: string;
}
let key: Buffer | undefined;
function masterKey() {
  if (key) return key;
  if (process.env.SANDBOXER_MASTER_KEY) {
    key = Buffer.from(process.env.SANDBOXER_MASTER_KEY, "hex");
    if (key.length !== 32)
      throw new Error("SANDBOXER_MASTER_KEY must be 64 hex characters");
    return key;
  }
  if (process.platform !== "darwin") {
    const path = join(dataDir, "master.key");
    const info = statSync(path);
    if ((info.mode & 0o077) !== 0 || info.uid !== process.getuid?.())
      throw new Error("master.key must be owned by this user and mode 0600");
    const value = readFileSync(path, "utf8").trim();
    if (!/^[a-f0-9]{64}$/i.test(value))
      throw new Error("master.key must contain 64 hex characters");
    key = Buffer.from(value, "hex");
    return key;
  }
  try {
    key = Buffer.from(
      execFileSync(
        "security",
        ["find-generic-password", "-s", "sandboxer", "-a", "vault", "-w"],
        { stdio: ["ignore", "pipe", "ignore"] },
      )
        .toString()
        .trim(),
      "hex",
    );
  } catch {
    key = randomBytes(32);
    execFileSync(
      "security",
      [
        "add-generic-password",
        "-s",
        "sandboxer",
        "-a",
        "vault",
        "-w",
        key.toString("hex"),
      ],
      { stdio: "ignore" },
    );
  }
  if (key.length !== 32) throw new Error("Invalid keychain key");
  return key;
}
export async function credentials() {
  return readJSON<Credential[]>("credentials.json", []);
}
export async function putCredential(
  id: string,
  kind: string,
  label: string,
  value: string,
) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", masterKey(), iv);
  cipher.setAAD(Buffer.from(id));
  const ciphertext = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  const rows = await credentials();
  await saveJSON("credentials.json", [
    ...rows.filter((r) => r.id !== id),
    {
      id,
      kind,
      label,
      ciphertext: ciphertext.toString("base64"),
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
    },
  ]);
}
export async function secret(id: string) {
  const c = (await credentials()).find((c) => c.id === id);
  if (!c) throw new Error(`Configure credential: ${id}`);
  const d = createDecipheriv(
    "aes-256-gcm",
    masterKey(),
    Buffer.from(c.iv, "base64"),
  );
  d.setAAD(Buffer.from(id));
  d.setAuthTag(Buffer.from(c.tag, "base64"));
  return Buffer.concat([
    d.update(Buffer.from(c.ciphertext, "base64")),
    d.final(),
  ]).toString("utf8");
}
