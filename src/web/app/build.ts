import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";

const sourceDir = path.resolve(process.cwd(), "src/web/static");
const targetDir = path.resolve(process.cwd(), "web-dist");
const entrypoint = path.resolve(process.cwd(), "src/web/app/main.tsx");

mkdirSync(sourceDir, { recursive: true });

if (existsSync(targetDir)) {
  rmSync(targetDir, { recursive: true, force: true });
}

mkdirSync(targetDir, { recursive: true });
cpSync(sourceDir, targetDir, { recursive: true });

const result = await Bun.build({
  entrypoints: [entrypoint],
  outdir: targetDir,
  target: "browser",
  minify: false,
  sourcemap: "none",
});

if (!result.success) {
  throw new Error(result.logs.map((log) => log.message).join("\n"));
}

console.log(`built web assets -> ${targetDir}`);
