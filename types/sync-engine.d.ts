// Type checking only (tsconfig.json). lib/sync.js installs these method groups on
// SyncEngine.prototype at load time; this declaration lets the checker see them.
import type { hostProcessMethods } from '../lib/engine/host-process.js';
import type { configMethods } from '../lib/engine/config.js';
import type { gitRunnerMethods } from '../lib/engine/git-runner.js';
import type { remoteRepoMethods } from '../lib/engine/remote-repo.js';
import type { conflictsMethods } from '../lib/engine/conflicts.js';
import type { workspaceSyncMethods } from '../lib/engine/workspace-sync.js';
import type { registryMethods } from '../lib/engine/registry.js';
import type { mainSyncMethods } from '../lib/engine/main-sync.js';
import type { restartMethods } from '../lib/engine/restart.js';
import type { runMethods } from '../lib/engine/run.js';
import type { statusMethods } from '../lib/engine/status.js';

type EngineMethods = typeof hostProcessMethods & typeof configMethods & typeof gitRunnerMethods
  & typeof remoteRepoMethods & typeof conflictsMethods & typeof workspaceSyncMethods & typeof registryMethods
  & typeof mainSyncMethods & typeof restartMethods & typeof runMethods & typeof statusMethods;

declare module '../lib/sync.js' {
  interface SyncEngine extends EngineMethods {}
}
