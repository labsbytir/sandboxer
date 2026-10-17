import { build } from "esbuild";
import { copyFile } from "node:fs/promises";
await Promise.all([
  build({
    entryPoints: ["src/panel/main.ts"],
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2022",
    outfile: "panel/main.js",
    minify: true,
  }),
  build({
    entryPoints: ["src/service/main.ts"],
    bundle: true,
    format: "cjs",
    platform: "node",
    target: "node22",
    outfile: "service/main.cjs",
    minify: true,
  }),
]);
await copyFile("src/panel/index.html", "panel/index.html");
await copyFile("src/panel/style.css", "panel/style.css");
