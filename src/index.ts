export {
  countTrailingZeros,
  validateBasePorts,
  parseEnvBase,
  findLowestUnusedOffset,
  computeWorktreeEnv,
  updateEnvFile,
  parseWorktreeList,
  detectWorktreeInfo,
  BEGIN_MARKER,
  END_MARKER,
} from "./worktree-env.js";

export type {
  PortEntry,
  StringEntry,
  EnvBaseResult,
  WorktreeEnvResult,
  WorktreeInfo,
} from "./worktree-env.js";
