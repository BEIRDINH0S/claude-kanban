/**
 * Downloads the Node binary for the host platform and places it at
 *   src-tauri/binaries/node-<target-triple>(.exe?)
 *
 * Tauri's externalBin requires this file to exist for both `tauri dev` and
 * `tauri build`; in production the binary is bundled inside the app, in dev
 * we still ship it to keep the conf consistent (the runtime falls back to
 * the system `node` on PATH for dev anyway).
 *
 * Run automatically via `postinstall` in package.json. Idempotent: skips the
 * download if the target file already exists.
 */
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, copyFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const NODE_VERSION = "v20.18.1";

const PLATFORMS = {
  "darwin-arm64": {
    triple: "aarch64-apple-darwin",
    archive: `node-${NODE_VERSION}-darwin-arm64.tar.gz`,
    binIn: "bin/node",
    binOut: "node",
  },
  "darwin-x64": {
    triple: "x86_64-apple-darwin",
    archive: `node-${NODE_VERSION}-darwin-x64.tar.gz`,
    binIn: "bin/node",
    binOut: "node",
  },
  "linux-x64": {
    triple: "x86_64-unknown-linux-gnu",
    archive: `node-${NODE_VERSION}-linux-x64.tar.xz`,
    binIn: "bin/node",
    binOut: "node",
  },
  "win32-x64": {
    triple: "x86_64-pc-windows-msvc",
    archive: `node-${NODE_VERSION}-win-x64.zip`,
    binIn: "node.exe",
    binOut: "node.exe",
    isExeTriple: true,
  },
};

const key = `${process.platform}-${process.arch}`;
const cfg = PLATFORMS[key];
if (!cfg) {
  console.error(
    `[fetch-sidecar-bin] Unsupported host platform: ${key}.\n` +
      `  Skipping. You'll need to drop a Node binary at\n` +
      `  src-tauri/binaries/node-<your-target-triple> manually.`,
  );
  process.exit(0);
}

const tripleSuffix = cfg.isExeTriple ? `${cfg.triple}.exe` : cfg.triple;
const targetPath = join("src-tauri", "binaries", `node-${tripleSuffix}`);
if (existsSync(targetPath)) {
  console.log(`[fetch-sidecar-bin] Already present: ${targetPath}`);
  process.exit(0);
}

mkdirSync(join("src-tauri", "binaries"), { recursive: true });

const url = `https://nodejs.org/dist/${NODE_VERSION}/${cfg.archive}`;
console.log(`[fetch-sidecar-bin] ${url}`);

const tmpArchive = join(tmpdir(), cfg.archive);
const tmpExtract = join(tmpdir(), `node-extract-${process.pid}`);
mkdirSync(tmpExtract, { recursive: true });

execSync(`curl -fL "${url}" -o "${tmpArchive}"`, { stdio: "inherit" });

// Use PowerShell on Windows, tar on Unix
if (process.platform === "win32") {
  execSync(`powershell -command "Expand-Archive -Path '${tmpArchive}' -DestinationPath '${tmpExtract}' -Force"`, { stdio: "inherit" });
} else {
  execSync(`tar -xf "${tmpArchive}" -C "${tmpExtract}"`, { stdio: "inherit" });
}

const folderName = cfg.archive.replace(/\.(tar\.(gz|xz)|zip)$/, "");
const sourceBin = join(tmpExtract, folderName, cfg.binIn);
copyFileSync(sourceBin, targetPath);
if (process.platform !== "win32") chmodSync(targetPath, 0o755);

console.log(`[fetch-sidecar-bin] OK: ${targetPath}`);
