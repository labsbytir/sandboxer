import { execFileSync } from "node:child_process";

// Publish committed branches only. Never force-push or delete remote branches.
const repositories = [
  "https://github.com/pennytir/sandboxer.git",
  "https://github.com/postdated/sandboxer.git",
];
const refs = ["refs/heads/main:refs/heads/main", "refs/heads/staging:refs/heads/staging"];
const dryRun = process.argv.includes("--dry-run");
for (const repository of repositories) {
  console.log(`Syncing main and staging to ${repository}`);
  execFileSync("git", ["push", "--atomic", ...(dryRun ? ["--dry-run"] : []), repository, ...refs], {
    stdio: "inherit",
  });
}
