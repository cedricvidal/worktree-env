// =============================================================================
// worktree-env.ts — Per-worktree .env management
// =============================================================================
// Core logic for computing per-worktree port offsets.
// Assigns a unique integer offset (1-99) per worktree and writes offset
// ports into a managed section of .env.
// =============================================================================

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, basename, resolve } from "path";

export const BEGIN_MARKER =
  "# --- BEGIN managed by worktree-env (do not edit) ---";
export const END_MARKER = "# --- END managed by worktree-env ---";

// --- Types -------------------------------------------------------------------

export interface PortEntry {
  name: string;
  base: number;
}

export interface StringEntry {
  name: string;
  value: string;
}

export interface EnvBaseResult {
  ports: PortEntry[];
  strings: StringEntry[];
}

export interface WorktreeEnvResult {
  worktreeName: string | null;
  offset: number;
  ports: Record<string, number>;
  strings: Record<string, string>;
}

export interface WorktreeInfo {
  worktreeName: string | null;
  siblingPaths: string[];
}

// --- Core logic --------------------------------------------------------------

/**
 * Count trailing zeros of a number.
 * e.g. 27000 → 3, 6300 → 2, 3140 → 1, 3141 → 0
 */
export function countTrailingZeros(n: number): number {
  if (n === 0) return 1;
  const s = String(n);
  let zeros = 0;
  for (let i = s.length - 1; i >= 0; i--) {
    if (s[i] === "0") zeros++;
    else break;
  }
  return zeros;
}

/**
 * Validate base ports. Returns { errors, warnings }.
 */
export function validateBasePorts(ports: PortEntry[]): {
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];
  for (const { name, base } of ports) {
    const zeros = countTrailingZeros(base);
    if (zeros < 1) {
      errors.push(
        `Base port ${name}=${base} has no trailing zeros — no room for offsets`,
      );
    } else if (zeros < 2) {
      warnings.push(
        `Base port ${name}=${base} has only 1 trailing zero — only 10 offsets available`,
      );
    }
  }
  return { errors, warnings };
}

/**
 * Parse .env.base file content into port entries (numeric values) and
 * string entries (non-numeric values like COMPOSE_PROJECT_NAME).
 */
export function parseEnvBase(content: string): EnvBaseResult {
  const ports: PortEntry[] = [];
  const strings: StringEntry[] = [];
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const name = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (!name || !value) continue;
    const num = parseInt(value, 10);
    if (!isNaN(num) && String(num) === value) {
      ports.push({ name, base: num });
    } else {
      strings.push({ name, value });
    }
  }
  return { ports, strings };
}

/**
 * Find the lowest unused positive integer offset by scanning
 * sibling worktree .port-offset files.
 */
export function findLowestUnusedOffset(
  siblingPaths: string[],
): number {
  const taken = new Set<number>();
  for (const wtPath of siblingPaths) {
    const offsetFile = join(wtPath, ".port-offset");
    if (existsSync(offsetFile)) {
      const val = parseInt(readFileSync(offsetFile, "utf-8").trim(), 10);
      if (!isNaN(val)) taken.add(val);
    }
  }
  let offset = 1;
  while (taken.has(offset)) offset++;
  return offset;
}

/**
 * Compute the worktree env: assign offset, compute ports.
 * String entries (like COMPOSE_PROJECT_NAME) get a `-<worktreeName>` suffix
 * appended when inside a worktree.
 */
export function computeWorktreeEnv(
  repoRoot: string,
  basePorts: PortEntry[],
  baseStrings: StringEntry[] = [],
  worktreeInfo: WorktreeInfo = { worktreeName: null, siblingPaths: [] },
): WorktreeEnvResult {
  const { worktreeName, siblingPaths } = worktreeInfo;
  let offset = 0;

  if (worktreeName !== null) {
    const portOffsetFile = join(repoRoot, ".port-offset");

    if (existsSync(portOffsetFile)) {
      offset = parseInt(readFileSync(portOffsetFile, "utf-8").trim(), 10);
      if (isNaN(offset)) offset = 1;
    } else {
      offset = findLowestUnusedOffset(siblingPaths);

      // Validate offset doesn't exceed range for any port
      for (const { name, base } of basePorts) {
        const zeros = countTrailingZeros(base);
        const maxOffset = Math.pow(10, zeros) - 1;
        if (offset > maxOffset) {
          throw new Error(
            `Offset ${offset} exceeds available range for ${name} (base=${base}, max_offset=${maxOffset})`,
          );
        }
      }

      writeFileSync(portOffsetFile, String(offset) + "\n");
    }
  }

  // Compute final ports
  const ports: Record<string, number> = {};
  for (const { name, base } of basePorts) {
    ports[name] = base + offset;
  }

  // Compute string values (append worktree suffix when in a worktree)
  const strings: Record<string, string> = {};
  for (const { name, value } of baseStrings) {
    strings[name] = worktreeName ? `${value}-${worktreeName}` : value;
  }

  return { worktreeName, offset, ports, strings };
}

/**
 * Update the .env file with the managed section.
 * Preserves any content outside the BEGIN/END markers.
 */
export function updateEnvFile(
  envFilePath: string,
  result: WorktreeEnvResult,
): void {
  // Build managed block
  const sortedPortKeys = Object.keys(result.ports).sort();
  const sortedStringKeys = Object.keys(result.strings).sort();
  const managedLines = [
    BEGIN_MARKER,
    `# Worktree: ${result.worktreeName ?? "main"}  |  Offset: ${result.offset}`,
    `# Auto-generated — changes will be overwritten on next run.`,
    ...sortedStringKeys.map((k) => `${k}=${result.strings[k]}`),
    ...sortedPortKeys.map((k) => `${k}=${result.ports[k]}`),
    END_MARKER,
  ];
  const managedBlock = managedLines.join("\n");

  if (existsSync(envFilePath)) {
    const existing = readFileSync(envFilePath, "utf-8");
    const beginIdx = existing.indexOf(BEGIN_MARKER);
    const endIdx = existing.indexOf(END_MARKER);

    if (beginIdx !== -1 && endIdx !== -1) {
      // Replace existing managed block
      const before = existing.slice(0, beginIdx);
      const after = existing.slice(endIdx + END_MARKER.length);
      writeFileSync(envFilePath, before + managedBlock + after);
    } else {
      // Append managed block
      const trailing = existing.endsWith("\n") ? "" : "\n";
      writeFileSync(
        envFilePath,
        existing + trailing + "\n" + managedBlock + "\n",
      );
    }
  } else {
    writeFileSync(envFilePath, managedBlock + "\n");
  }
}

// --- Git worktree detection --------------------------------------------------

/**
 * Parse the output of `git worktree list --porcelain` into an array of
 * worktree root paths.
 */
export function parseWorktreeList(porcelainOutput: string): string[] {
  const paths: string[] = [];
  for (const line of porcelainOutput.split("\n")) {
    if (line.startsWith("worktree ")) {
      paths.push(line.slice("worktree ".length));
    }
  }
  return paths;
}

/**
 * Detect worktree info from git command outputs (pure — no subprocess calls).
 *
 * @param gitDir        Output of `git rev-parse --git-dir` (trimmed)
 * @param gitCommonDir  Output of `git rev-parse --git-common-dir` (trimmed)
 * @param worktreeListOutput  Output of `git worktree list --porcelain`
 * @param currentPath   The current worktree root (from `git rev-parse --show-toplevel`)
 */
export function detectWorktreeInfo(
  gitDir: string,
  gitCommonDir: string,
  worktreeListOutput: string,
  currentPath: string,
): WorktreeInfo {
  const resolvedGitDir = resolve(gitDir);
  const resolvedCommonDir = resolve(gitCommonDir);

  if (resolvedGitDir === resolvedCommonDir) {
    // Main repo — not a worktree
    return { worktreeName: null, siblingPaths: [] };
  }

  // In a worktree: gitDir is something like /path/to/.git/worktrees/<name>
  const worktreeName = basename(resolvedGitDir);

  // Parse all worktree paths and exclude the current one
  const allPaths = parseWorktreeList(worktreeListOutput);
  const siblingPaths = allPaths.filter(
    (p) => resolve(p) !== resolve(currentPath),
  );

  return { worktreeName, siblingPaths };
}
