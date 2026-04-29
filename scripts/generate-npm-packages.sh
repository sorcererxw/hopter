#!/usr/bin/env bash
set -euo pipefail

version=""
release_dir=""
output=""
repo="sorcererxw/hopter"
package_name="hopter"
binary_scope="@hopter"

usage() {
  cat <<'EOF'
Usage:
  scripts/generate-npm-packages.sh --version v0.0.1 --release-dir release --output dist/npm

Options:
  --version       Release version, with or without leading v
  --release-dir   Directory containing hopter-npm-<os>-<arch> release binaries
  --output        Directory where npm package folders will be generated
  --repo          GitHub repository metadata, default: sorcererxw/hopter
  --package-name  Main npm package name, default: hopter
  --binary-scope  Scope for platform binary packages, default: @hopter
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
    --binary-scope)
      binary_scope="${2:-}"
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

if [[ -z "$version" || -z "$release_dir" || -z "$output" ]]; then
  usage >&2
  exit 2
fi

if [[ ! -d "$release_dir" ]]; then
  echo "release directory not found: $release_dir" >&2
  exit 1
fi

version="${version#v}"
binary_scope="${binary_scope%/}"

if [[ "$binary_scope" != @* ]]; then
  echo "binary scope must start with @: $binary_scope" >&2
  exit 2
fi

platform_package_name() {
  local platform="$1"
  printf '%s/%s' "$binary_scope" "$platform"
}

copy_binary() {
  local asset="$1"
  local package_dir="$2"
  local source_path="${release_dir}/${asset}"
  if [[ ! -f "$source_path" ]]; then
    echo "release asset not found: $source_path" >&2
    exit 1
  fi
  mkdir -p "${package_dir}/bin"
  install -m 0755 "$source_path" "${package_dir}/bin/hopter"
}

write_platform_package() {
  local platform="$1"
  local npm_os="$2"
  local npm_cpu="$3"
  local asset="$4"
  local package_dir="${output}/${platform}"
  local package_full_name
  package_full_name="$(platform_package_name "$platform")"

  mkdir -p "$package_dir"
  copy_binary "$asset" "$package_dir"

  cat > "${package_dir}/package.json" <<EOF
{
  "name": "${package_full_name}",
  "version": "${version}",
  "description": "Hopter native binary for ${platform}",
  "license": "Apache-2.0",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/${repo}.git"
  },
  "os": ["${npm_os}"],
  "cpu": ["${npm_cpu}"],
  "files": [
    "bin/hopter",
    "README.md"
  ],
  "publishConfig": {
    "access": "public"
  }
}
EOF

  cat > "${package_dir}/README.md" <<EOF
# ${package_full_name}

Native Hopter binary for ${platform}. This package is installed automatically by \`${package_name}\` as an optional platform dependency.
EOF
}

rm -rf "$output"
mkdir -p "$output"

write_platform_package "darwin-arm64" "darwin" "arm64" "hopter-npm-darwin-arm64"
write_platform_package "darwin-x64" "darwin" "x64" "hopter-npm-darwin-amd64"
write_platform_package "linux-arm64" "linux" "arm64" "hopter-npm-linux-arm64"
write_platform_package "linux-x64" "linux" "x64" "hopter-npm-linux-amd64"

main_dir="${output}/main"
mkdir -p "${main_dir}/bin"

darwin_arm64_package="$(platform_package_name darwin-arm64)"
darwin_x64_package="$(platform_package_name darwin-x64)"
linux_arm64_package="$(platform_package_name linux-arm64)"
linux_x64_package="$(platform_package_name linux-x64)"

cat > "${main_dir}/bin/hopter.js" <<EOF
#!/usr/bin/env node
"use strict";

const { spawn } = require("node:child_process");

const packages = {
  "darwin-arm64": "${darwin_arm64_package}",
  "darwin-x64": "${darwin_x64_package}",
  "linux-arm64": "${linux_arm64_package}",
  "linux-x64": "${linux_x64_package}",
};

const key = process.platform + "-" + process.arch;
const packageName = packages[key];

if (!packageName) {
  console.error("hopter does not provide an npm binary for " + key + ".");
  process.exit(1);
}

let binaryPath;
try {
  binaryPath = require.resolve(packageName + "/bin/hopter");
} catch (error) {
  console.error("The platform package " + packageName + " is missing.");
  console.error("Reinstall hopter without omitting optional dependencies.");
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
  "files": [
    "bin/hopter.js",
    "README.md"
  ],
  "optionalDependencies": {
    "${darwin_arm64_package}": "${version}",
    "${darwin_x64_package}": "${version}",
    "${linux_arm64_package}": "${version}",
    "${linux_x64_package}": "${version}"
  },
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

This package installs the matching native Hopter binary through optional platform packages.
EOF

echo "Generated npm packages in: $output"
