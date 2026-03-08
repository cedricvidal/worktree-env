#!/usr/bin/env node
// =============================================================================
// cli.ts — worktree-env CLI entry point
// =============================================================================

import { readFileSync, existsSync } from "fs";
import { execSync } from "child_process";
import { join } from "path";
import {
  parseEnvBase,
  validateBasePorts,
  computeWorktreeEnv,
  updateEnvFile,
} from "./worktree-env.js";

function printHelp(): void {
  console.log(`worktree-env — Automatic per-worktree .env management

Usage:
  worktree-env [options]

Options:
  --env-base <path>   Path to .env.base file (default: <repo-root>/.env.base)
  --env-file <path>   Path to output .env file (default: <repo-root>/.env)
  --help              Show this help message

Behavior:
  In main repo:  offset = 0, base values used as-is.
  In worktree:   offset = unique integer (1-99), persisted in .port-offset.

  Numeric values in .env.base get the offset added (e.g. API_PORT=3100 → 3101).
  String values in .env.base get a -<worktree-name> suffix appended
  (e.g. PROJECT_NAME=my-app → my-app-feature-branch).
`);
}

function parseArgs(argv: string[]): {
  envBase?: string;
  envFile?: string;
  help: boolean;
} {
  const result: { envBase?: string; envFile?: string; help: boolean } = {
    help: false,
  };
  for (let i = 2; i < argv.length; i++) {
    switch (argv[i]) {
      case "--env-base":
        result.envBase = argv[++i];
        break;
      case "--env-file":
        result.envFile = argv[++i];
        break;
      case "--help":
      case "-h":
        result.help = true;
        break;
    }
  }
  return result;
}

function main(): void {
  const args = parseArgs(process.argv);

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  // Detect repo root via git
  let repoRoot: string;
  try {
    repoRoot = execSync("git rev-parse --show-toplevel", {
      encoding: "utf-8",
    }).trim();
  } catch {
    console.error("ERROR: Not inside a git repository");
    process.exit(1);
    return; // unreachable, helps TypeScript narrowing
  }

  const envBasePath = args.envBase ?? join(repoRoot, ".env.base");
  const envFilePath = args.envFile ?? join(repoRoot, ".env");

  // Read and parse .env.base
  if (!existsSync(envBasePath)) {
    console.error(`ERROR: ${envBasePath} not found`);
    process.exit(1);
  }
  const { ports: basePorts, strings: baseStrings } = parseEnvBase(
    readFileSync(envBasePath, "utf-8"),
  );

  // Validate base ports
  const { errors, warnings } = validateBasePorts(basePorts);
  for (const w of warnings) console.warn(`WARNING: ${w}`);
  if (errors.length > 0) {
    for (const e of errors) console.error(`ERROR: ${e}`);
    process.exit(1);
  }

  // Compute env
  const result = computeWorktreeEnv(repoRoot, basePorts, baseStrings);

  // Write .env
  updateEnvFile(envFilePath, result);

  // Summary
  const label = result.worktreeName ?? "main";
  const portSummary = Object.entries(result.ports)
    .map(([k, v]) => `${k.replace(/_PORT$/, "")}: ${v}`)
    .join(" | ");
  const stringSummary = Object.entries(result.strings)
    .map(([k, v]) => `${k}: ${v}`)
    .join(" | ");
  const parts = [`[worktree-env] ${label} | Offset: ${result.offset}`];
  if (portSummary) parts.push(portSummary);
  if (stringSummary) parts.push(stringSummary);
  console.log(parts.join(" | "));
}

main();
