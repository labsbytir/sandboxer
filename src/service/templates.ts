import { readdir, readFile, realpath } from "node:fs/promises";
import { resolve, join, relative } from "node:path";
import { createHash } from "node:crypto";
import { parse, stringify } from "yaml";
import { z } from "zod";
import type { Template } from "../core/contracts";
const bundledRoot =
  typeof __dirname === "string"
    ? resolve(__dirname, "../templates")
    : resolve("templates");
const meta = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  description: z.string().default(""),
});
export function parseTemplate(text: string, source: string): Template {
  const front = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const block = text.match(/```cloud-init\r?\n([\s\S]*?)\r?\n```/);
  if (!front || !block)
    throw new Error(
      "Template requires YAML frontmatter and a cloud-init fenced block",
    );
  const info = meta.parse(parse(front[1]));
  const config = parse(block[1]);
  if (!config || typeof config !== "object" || Array.isArray(config))
    throw new Error("cloud-init must be a YAML mapping");
  return {
    ...info,
    cloudInit: block[1],
    digest: createHash("sha256").update(text).digest("hex"),
    source,
  };
}
export async function templates(vaultPath = "") {
  const result: Template[] = [];
  for (const root of [
    bundledRoot,
    ...(vaultPath ? [resolve(vaultPath)] : []),
  ]) {
    const realRoot = await realpath(root);
    for (const f of await readdir(realRoot, { withFileTypes: true })) {
      if (!f.isFile() || !f.name.endsWith(".md")) continue;
      const p = await realpath(join(realRoot, f.name));
      if (relative(realRoot, p).startsWith(".."))
        throw new Error("Template outside vault");
      const template = parseTemplate(
        await readFile(p, "utf8"),
        root === resolve(vaultPath) ? "obsidian" : "bundled",
      );
      if (result.some((t) => t.id === template.id))
        throw new Error("Duplicate template ID: " + template.id);
      result.push(template);
    }
  }
  return result;
}
export function renderCloudInit(
  template: Template,
  id: string,
  sshKey: string,
) {
  const doc = parse(template.cloudInit);
  doc.hostname = id;
  doc.ssh_pwauth = false;
  doc.disable_root = true;
  doc.users = [
    {
      name: "sandboxer",
      groups: ["sudo"],
      shell: "/bin/bash",
      sudo: ["ALL=(ALL) NOPASSWD:ALL"],
      ssh_authorized_keys: [sshKey],
    },
  ];
  doc.write_files = [
    ...(doc.write_files || []),
    {
      path: "/etc/sandboxer/environment.json",
      permissions: "0644",
      content: JSON.stringify({
        environment_id: id,
        domain: id + ".tirbox.site",
      }),
    },
  ];
  return "#cloud-config\n" + stringify(doc);
}
