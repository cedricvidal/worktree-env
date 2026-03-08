# worktree-env

Automatic per-worktree `.env` management for git worktrees — unique port offsets and string suffixes so parallel workspaces never collide.

## Problem

When running multiple git worktrees of the same project, services bind to the same ports and collide. You either juggle `.env` files manually or shut down one workspace before starting another.

## Solution

`worktree-env` assigns each worktree a unique integer offset (1–99) and writes computed values into a managed section of `.env`. The main checkout uses offset 0 (base values as-is). Numeric values get the offset added to them, and string values get a `-<worktree>` suffix appended — useful for isolating project names, container prefixes, or any identifier that needs to be unique per worktree.

## Install

```bash
npm install -D worktree-env
```

## Setup

Create a `.env.base` file in your repo root with your base port numbers and any string values that need per-worktree suffixes:

```env
PROJECT_NAME=my-app
API_PORT=3100
DB_PORT=27000
CACHE_PORT=6300
```

**Base port rule:** ports must have at least one trailing zero to leave room for offsets. Two or more trailing zeros is recommended (supports up to 99 worktrees).

## Usage

### CLI

```bash
npx worktree-env
```

This will:

1. Detect whether you're in the main repo or a worktree (by checking for a `.worktrees/` parent directory)
2. Assign offset 0 (main) or a unique offset (worktree), persisted in `.port-offset`
3. Write a managed block into `.env` with computed values

**Main repo** output:

```
[worktree-env] main | Offset: 0 | API: 3100 | DB: 27000 | CACHE: 6300 | PROJECT_NAME: my-app
```

**Worktree** (`my-feature`) output:

```
[worktree-env] my-feature | Offset: 1 | API: 3101 | DB: 27001 | CACHE: 6301 | PROJECT_NAME: my-app-my-feature
```

### CLI options

```
--env-base <path>   Path to .env.base file (default: <repo-root>/.env.base)
--env-file <path>   Path to output .env file (default: <repo-root>/.env)
--help              Show help message
```

### In package.json scripts

Run `worktree-env` before any command that reads `.env`:

```json
{
  "scripts": {
    "dev": "worktree-env && next dev",
    "docker:up": "worktree-env && docker compose up -d",
    "start": "worktree-env && node server.js"
  }
}
```

### Programmatic API

```typescript
import {
  parseEnvBase,
  validateBasePorts,
  computeWorktreeEnv,
  updateEnvFile,
} from "worktree-env";

const { ports, strings } = parseEnvBase(envBaseContent);
const { errors, warnings } = validateBasePorts(ports);
const result = computeWorktreeEnv(repoRoot, ports, strings);
updateEnvFile(".env", result);
```

## How offsets work

| Location | Offset | `API_PORT` (base 3100) | `PROJECT_NAME` (base `my-app`) |
|---|---|---|---|
| Main repo | 0 | 3100 | `my-app` |
| Worktree `feat-a` | 1 | 3101 | `my-app-feat-a` |
| Worktree `feat-b` | 2 | 3102 | `my-app-feat-b` |

- Offsets are assigned as the lowest unused positive integer across sibling worktrees
- Each worktree's offset is persisted in a `.port-offset` file so it stays stable across runs
- Deleted worktrees free their offset for reuse

## Generated `.env` block

`worktree-env` manages a clearly marked section in your `.env` file. Content outside the markers is preserved:

```env
# your own vars above are untouched
MY_CUSTOM_VAR=hello

# --- BEGIN managed by worktree-env (do not edit) ---
# Worktree: feat-a  |  Offset: 1
# Auto-generated — changes will be overwritten on next run.
PROJECT_NAME=my-app-feat-a
API_PORT=3101
CACHE_PORT=6301
DB_PORT=27001
# --- END managed by worktree-env ---
```

## AI coding agents

`worktree-env` works well with AI coding agents that use git worktrees for task isolation. Once wired into your `package.json` scripts, every worktree — whether created by a developer or an agent like Claude Code or GitHub Copilot — gets unique ports automatically with no extra configuration.

```json
{
  "scripts": {
    "docker:up": "worktree-env && docker compose up -d"
  }
}
```

Any agent that runs `npm run docker:up` in a worktree gets isolated ports for free.

## Requirements

- Node.js >= 18
- Git repository with worktrees (any layout — `git worktree add` works out of the box)

## License

MIT
