#!/usr/bin/env bash
set -euo pipefail

version=""
release_dir=""
output=""
repo="sorcererxw/hopter"
package_name="@sorcererxw/hopter"

usage() {
  cat <<'EOF'
Usage:
  scripts/generate-npm-packages.sh --version v0.0.1 --output dist/npm

Options:
  --version       Release version, with or without leading v
  --release-dir   Accepted for compatibility; npm postinstall downloads from GitHub Release
  --output        Directory where the npm package folder will be generated
  --repo          GitHub repository metadata, default: sorcererxw/hopter
  --package-name  npm package name, default: @sorcererxw/hopter
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version)
      version="${2:-}"
      shift 2
      ;;
    --release-dir)
      release_dir="${2:-}"
      shift 2
      ;;
    --output)
      output="${2:-}"
      shift 2
      ;;
    --repo)
      repo="${2:-}"
      shift 2
      ;;
    --package-name)
      package_name="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ -z "$version" || -z "$output" ]]; then
  usage >&2
  exit 2
fi

version="${version#v}"

rm -rf "$output"
main_dir="${output}/main"
mkdir -p "${main_dir}/bin" "${main_dir}/scripts"

cat > "${main_dir}/bin/hopter.js" <<'EOF'
#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const binaryName = process.platform === "win32" ? "hopter.exe" : "hopter";
const binaryPath = path.join(__dirname, "..", "vendor", binaryName);

if (!fs.existsSync(binaryPath)) {
  console.error("The Hopter native binary is missing.");
  console.error("Run `npm rebuild hopter` or reinstall with lifecycle scripts enabled.");
  process.exit(1);
}

const child = spawn(binaryPath, process.argv.slice(2), {
  stdio: "inherit",
});

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    if (!child.killed) {
      child.kill(signal);
    }
  });
}

child.on("error", (error) => {
  console.error(error.message);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
EOF

chmod 0755 "${main_dir}/bin/hopter.js"

cat > "${main_dir}/scripts/install.js" <<EOF
#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const https = require("node:https");
const os = require("node:os");
const path = require("node:path");

const packageJson = require("../package.json");
const repo = "${repo}";
const tag = "v" + packageJson.version;
const assetName = resolveAssetName();
const baseURL = "https://github.com/" + repo + "/releases/download/" + tag;
const checksumsURL = baseURL + "/checksums.txt";
const assetURL = baseURL + "/" + assetName;
const vendorDir = path.join(__dirname, "..", "vendor");
const binaryName = process.platform === "win32" ? "hopter.exe" : "hopter";
const finalPath = path.join(vendorDir, binaryName);
const tempPath = path.join(vendorDir, binaryName + ".tmp-" + process.pid);

function resolveAssetName() {
  const key = process.platform + "-" + process.arch;
  const assets = {
    "darwin-arm64": "hopter-npm-darwin-arm64",
    "darwin-x64": "hopter-npm-darwin-amd64",
    "linux-arm64": "hopter-npm-linux-arm64",
    "linux-x64": "hopter-npm-linux-amd64",
  };
  const asset = assets[key];
  if (!asset) {
    throw new Error("hopter does not provide an npm binary for " + key);
  }
  return asset;
}

function request(url, redirectCount = 0) {
  if (redirectCount > 5) {
    return Promise.reject(new Error("too many redirects while downloading " + url));
  }

  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        "User-Agent": "hopter-npm-install",
      },
    }, (response) => {
      const location = response.headers.location;
      if (response.statusCode >= 300 && response.statusCode < 400 && location) {
        response.resume();
        const nextURL = new URL(location, url).toString();
        resolve(request(nextURL, redirectCount + 1));
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error("download failed for " + url + ": HTTP " + response.statusCode));
        return;
      }
      resolve(response);
    });
    req.on("error", reject);
  });
}

async function readText(url) {
  const response = await request(url);
  const chunks = [];
  for await (const chunk of response) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function checksumForAsset(checksums, name) {
  for (const line of checksums.split(/\\r?\\n/)) {
    const fields = line.trim().split(/\\s+/);
    if (fields.length >= 2 && fields[fields.length - 1] === name) {
      return fields[0].toLowerCase();
    }
  }
  throw new Error("checksums.txt is missing entry for " + name);
}

async function downloadFile(url, outputPath) {
  const response = await request(url);
  await new Promise((resolve, reject) => {
    const file = fs.createWriteStream(outputPath, { mode: 0o755 });
    response.pipe(file);
    response.on("error", reject);
    file.on("error", reject);
    file.on("finish", () => file.close(resolve));
  });
}

async function main() {
  fs.mkdirSync(vendorDir, { recursive: true });
  const checksums = await readText(checksumsURL);
  const expectedSHA256 = checksumForAsset(checksums, assetName);

  await downloadFile(assetURL, tempPath);

  const actualSHA256 = crypto
    .createHash("sha256")
    .update(fs.readFileSync(tempPath))
    .digest("hex");

  if (actualSHA256 !== expectedSHA256) {
    fs.rmSync(tempPath, { force: true });
    throw new Error("checksum mismatch for " + assetName + ": expected " + expectedSHA256 + ", got " + actualSHA256);
  }

  fs.chmodSync(tempPath, 0o755);
  fs.renameSync(tempPath, finalPath);
  console.log("Installed Hopter binary " + assetName + " for " + os.platform() + "/" + os.arch());
}

main().catch((error) => {
  fs.rmSync(tempPath, { force: true });
  console.error(error.message);
  process.exit(1);
});
EOF

chmod 0755 "${main_dir}/scripts/install.js"

cat > "${main_dir}/package.json" <<EOF
{
  "name": "${package_name}",
  "version": "${version}",
  "description": "Self-hosted remote control plane for local coding agents",
  "license": "Apache-2.0",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/${repo}.git"
  },
  "bin": {
    "hopter": "bin/hopter.js"
  },
  "scripts": {
    "postinstall": "node scripts/install.js"
  },
  "files": [
    "bin/hopter.js",
    "scripts/install.js",
    "README.md"
  ],
  "publishConfig": {
    "access": "public"
  }
}
EOF

cat > "${main_dir}/README.md" <<EOF
# Hopter

Hopter lets you control local coding agents from a browser.

\`\`\`bash
npm install -g ${package_name}
hopter
\`\`\`

This package downloads the matching native Hopter binary from the GitHub release during npm postinstall.
EOF

echo "Generated npm package in: $main_dir"
