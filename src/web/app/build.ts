import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";

const sourceStaticDir = path.resolve(process.cwd(), "src/web/static");
const targetDir = path.resolve(process.cwd(), "web-dist");
const entrypoint = path.resolve(process.cwd(), "src/web/app/main.tsx");
const cssInput = path.resolve(process.cwd(), "src/web/app/styles/index.css");
const cssOutput = path.resolve(targetDir, "app.css");

mkdirSync(sourceStaticDir, { recursive: true });

if (existsSync(targetDir)) {
  rmSync(targetDir, { recursive: true, force: true });
}

mkdirSync(targetDir, { recursive: true });
cpSync(sourceStaticDir, targetDir, { recursive: true, filter: (source) => !source.endsWith(`${path.sep}app.css`) });

const cssBuild = spawnSync("bunx", ["--bun", "@tailwindcss/cli", "-i", cssInput, "-o", cssOutput], {
  stdio: "inherit",
  env: process.env,
});

if (cssBuild.status !== 0) {
  throw new Error(`tailwind css build failed with exit code ${cssBuild.status}`);
}

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
