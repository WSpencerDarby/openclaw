#!/usr/bin/env node
/**
 * Git Bash on Windows does not inherit the same PATH as PowerShell/conda, so `node` is missing
 * inside `bash scripts/bundle-a2ui.sh` even though `pnpm` (invoked via Node) works.
 * Prepend this Node's directory to PATH for the bash child so `node` resolves.
 */
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nodeBinDir = path.dirname(process.execPath);
const sep = path.delimiter;
const env = {
  ...process.env,
  PATH: `${nodeBinDir}${sep}${process.env.PATH ?? ""}`,
};

function resolveBash() {
  if (process.platform !== "win32") {
    return "bash";
  }
  const candidates = [
    "C:\\Program Files\\Git\\bin\\bash.exe",
    "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
  ];
  for (const c of candidates) {
    if (existsSync(c)) {
      return c;
    }
  }
  return "bash";
}

const bash = resolveBash();
const script = path.join(root, "scripts", "bundle-a2ui.sh");
const result = spawnSync(bash, [script], {
  cwd: root,
  env,
  stdio: "inherit",
});

process.exit(result.status === null ? 1 : result.status);
