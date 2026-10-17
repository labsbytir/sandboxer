import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { audit, readJSON, saveJSON, serialized } from "./store";
import type { Environment } from "../core/contracts";
export interface Job {
  id: string;
  action: string;
  target: string;
  status: "running" | "succeeded" | "failed" | "interrupted";
  startedAt: string;
  endedAt?: string;
  error?: string;
}
const active = new Set<string>();
export async function startJob(
  action: string,
  target: string,
  fn: () => Promise<void>,
) {
  const job: Job = {
    id: randomUUID(),
    action,
    target,
    status: "running",
    startedAt: new Date().toISOString(),
  };
  await serialized(async () => {
    await saveJSON(
      "jobs.json",
      [job, ...(await readJSON<Job[]>("jobs.json", []))].slice(0, 100),
    );
    await audit(action, target, "started");
  });
  active.add(job.id);
  void fn()
    .then(
      () => finish("succeeded"),
      () => finish("failed"),
    )
    .catch((e) =>
      console.error(
        "Job persistence failed",
        e instanceof Error ? e.name : "error",
      ),
    );
  async function finish(status: "succeeded" | "failed") {
    active.delete(job.id);
    await serialized(async () => {
      const jobs = await readJSON<Job[]>("jobs.json", []);
      await saveJSON(
        "jobs.json",
        jobs.map((j) =>
          j.id === job.id
            ? {
                ...j,
                status,
                endedAt: new Date().toISOString(),
                ...(status === "failed"
                  ? {
                      error:
                        "Operation failed. Check provider state and remote service logs before retrying.",
                    }
                  : {}),
              }
            : j,
        ),
      );
      await audit(action, target, status);
    });
  }
  return job;
}
export async function listJobs() {
  return (await readJSON<Job[]>("jobs.json", [])).map((j) =>
    j.status === "running" && !active.has(j.id)
      ? { ...j, status: "interrupted" }
      : j,
  );
}
export function execute(
  binary: string,
  args: string[],
  stdin = "",
  timeout = 600_000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ["pipe", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (b) => {
      output += b.toString();
      if (output.length > 1_000_000) {
        child.kill();
        reject(new Error("Output limit exceeded"));
      }
    });
    child.stderr.resume();
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("Command timeout"));
    }, timeout);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      code === 0
        ? resolve(output)
        : reject(new Error(`${binary} exited ${code}`));
    });
    child.stdin.on("error", () => {});
    child.stdin.end(stdin);
  });
}
export function quote(value: string) {
  return "'" + value.replaceAll("'", "'\\''") + "'";
}
export function ssh(env: Environment, script: string) {
  if (!env.host || !/^\d{1,3}(\.\d{1,3}){3}$/.test(env.host))
    throw new Error("Environment needs a public IPv4 address");
  return execute(
    "ssh",
    [
      "-o",
      "BatchMode=yes",
      "-o",
      "StrictHostKeyChecking=yes",
      "-o",
      "ConnectTimeout=15",
      `${env.sshUser}@${env.host}`,
      "bash -se",
    ],
    script,
  );
}
export function deploymentScript(
  repo: string,
  sha: string,
  install: string,
  build: string,
  test: string,
  start: string,
) {
  return `set -euo pipefail\nROOT="$HOME/sandboxer/projects/${repo.split("/")[1]}"\nmkdir -p "$ROOT/releases"\nexec 9>"$ROOT/deploy.lock"\nflock -n 9\nRELEASE=$(mktemp -d "$ROOT/releases/${sha}.XXXXXX")\nif [ ! -d "$ROOT/repository.git" ]; then git clone --mirror ${quote("git@github.com:" + repo + ".git")} "$ROOT/repository.git"; fi\ngit -C "$ROOT/repository.git" fetch origin staging\ngit -C "$ROOT/repository.git" merge-base --is-ancestor ${quote(sha)} FETCH_HEAD\nmkdir -p "$RELEASE"\ngit -C "$ROOT/repository.git" archive ${quote(sha)} | tar -x -C "$RELEASE"\ncd "$RELEASE"\n${install}\n${build}\n${test}\nPREVIOUS=$(readlink "$ROOT/current" || true)\nln -sfn "$RELEASE" "$ROOT/current.next"\nmv -Tf "$ROOT/current.next" "$ROOT/current"\nif ! ( ${start} ); then\n if [ -n "$PREVIOUS" ]; then\n  ln -sfn "$PREVIOUS" "$ROOT/current.next"\n  mv -Tf "$ROOT/current.next" "$ROOT/current"\n  cd "$PREVIOUS"\n  ( ${start} ) || true\n else\n  rm -f "$ROOT/current"\n fi\n exit 1\nfi\nprintf 'Deployed %s\\n' ${quote(sha)}\n`;
}
