// Part of the SyncEngine (lib/sync.js); moved verbatim from lib/sync.js.
import fs from 'node:fs';
import { detectDshVersion } from '../recovery-guide.js';

// Paths below were written relative to lib/sync.js.
const SYNC_MODULE_URL = new URL('../sync.js', import.meta.url).href;

// Which DSH host this process is, on any OS. Exit upload and update commands depend
// on it. Isolated tests and the standalone CLI match neither.
export function isWebHostProcess(argv = process.argv) {
  return /(?:^|[\\/])@deepseek-ai[\\/]dsh[\\/]lib[\\/]bin\.js$/i.test(argv[1] || '') && argv.includes('web');
}
export function isDesktopHostProcess(argv = process.argv) {
  return (
    /(?:^|[\\/])@deepseek-ai[\\/]dsh-desktop-host[\\/]lib[\\/]index\.js$/i.test(argv[1] || '') &&
    argv.some(arg => /[\\/]profiles[\\/]desktop$/i.test(arg))
  );
}
// Closing and reopening the app relies on schtasks and a PowerShell script, so only Windows has it.
export function desktopRestartSupported(argv = process.argv, platform = process.platform) {
  return platform === 'win32' && isDesktopHostProcess(argv);
}

// The system credential store Git uses here when GitHub CLI is not the one signing in.
// Git Credential Manager is not part of Git on macOS; the Keychain helper is.
export function nativeCredentialHelper(platform = process.platform) {
  return platform === 'darwin' ? 'osxkeychain' : 'manager';
}

export const hostProcessMethods = {
  /** Version of this ChatSync package, published in device receipts. */
  pluginVersion() {
    if (this._pluginVersion === undefined) {
      try {
        this._pluginVersion =
          JSON.parse(fs.readFileSync(new URL('../package.json', SYNC_MODULE_URL), 'utf8')).version || null;
      } catch {
        this._pluginVersion = null;
      }
    }
    return this._pluginVersion;
  },

  /** Installed DSH version of this host, or null when it cannot be determined. */
  hostDshVersion() {
    if (this._hostDshVersion === undefined) this._hostDshVersion = detectDshVersion();
    return this._hostDshVersion;
  },
};
