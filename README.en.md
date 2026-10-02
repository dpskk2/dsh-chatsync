<div align="center">

# DSH ChatSync

### Pick up where you left off.

Sync DeepSeek Harness (DSH) conversations, attachments, settings and project files across your computers.<br>
Your data stays in your own private GitHub repository.

[![npm](https://img.shields.io/npm/v/%40dpskk2%2Fdsh-chatsync?color=2563eb)](https://www.npmjs.com/package/@dpskk2/dsh-chatsync)
[![MIT](https://img.shields.io/badge/license-MIT-slateblue)](LICENSE)

[Get started](#first-time-setup) · [Detailed guide](docs/getting-started.md) (Chinese) · [Source downloads](https://github.com/dpskk2/dsh-chatsync/releases/latest) · [Changelog](CHANGELOG.md) (Chinese) · [中文](README.md)

</div>

For alternating between your own computers: sync on the first, retrieve on the next, and continue.

- **Synced:** conversations, attachments, model and interface settings, and workspace project files.
- **Set up separately:** model API keys, other plugins and project dependencies on each computer.
- **Bring your projects along:** sync workspace project files as well as conversations, so you can keep chatting and working on another computer.

## First-time setup

Before you start: DSH opens normally, [Git](https://git-scm.com/downloads/) and [GitHub CLI](https://cli.github.com/) are installed, and GitHub is reachable.

### ① Install the plugin

Run the command for your host in PowerShell; install separately if you use both.

**Web:**

```sh
dsh plugin --profile web add @dpskk2/dsh-chatsync
```

**Desktop (default Windows installation):**

```powershell
& "$env:LOCALAPPDATA\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop add @dpskk2/dsh-chatsync
```

Open Desktop once, then fully quit it (including its tray icon) before installing. For custom installation paths or errors, see the [desktop installation guide](docs/getting-started.md#桌面端桌面应用).

### ② Sign in to GitHub

```sh
gh auth login --hostname github.com --git-protocol https --web
```

Complete browser authorization. Choose **Yes** when asked to authenticate Git with this account.

### ③ Sync on your original computer

Restart DSH, open **设置 → 同步** (Settings → Sync), and click **立即同步** (Sync now). The default setup creates or reuses a private GitHub repository automatically.

**Note:** turn off **同步工作区文件** and save first if you do not need project files. A local snapshot alone means nothing has been uploaded yet.

### ④ Retrieve on your new computer

Repeat ①② with the **same GitHub account**, restart DSH, and sync. After retrieval succeeds, restart again and configure local model API keys to continue your conversations.

**Note:** install other plugins and project dependencies separately. For a custom repository, use the same URL and branch on both computers.

## Everyday use

**Sync before starting and after finishing; confirm success before switching computers.** Click **⟳ 同步** in the sidebar. To automate syncing, enable it under **设置 → 同步 → 同步偏好** and save.

## Detailed instructions

The linked guides are in Chinese.

- **Installation and troubleshooting:** [tools, Desktop setup, the two dsh commands and common issues](docs/getting-started.md).
- **Switching computers:** [retrieval, project paths and dependencies](docs/getting-started.md#第二台电脑).
- **Sync settings:** [automatic sync, intervals, proxies and custom repositories](docs/configuration.md).
- **Sync scope:** [included data and exclusion rules](docs/sync-content.md).

### Features and limits

- **Workspace grouping:** syncs conversation-to-workspace mappings and attempts to repair missing registrations; prompts for a restart when the sidebar needs refreshing.
- **Automatic sync:** off by default. When enabled, defaults to five-minute intervals and responds to session activity. Startup sync is bidirectional; normal exit attempts to save and upload. DSH must stay running with network access. See [Configuration](docs/configuration.md).
- **Conflict handling:** confirmed append-only histories are preserved verbatim. Divergent sessions retain one side, with both originals in Git history and recovery references in sync details. Settings merge field by field; ordinary file conflicts usually keep the local version.
- **Restart repair:** on Windows, instructions and actions follow the host: Web restarts its service; Desktop closes and reopens the app. Automatic restart is on by default; explicit opt-outs are preserved. Detected session activity pauses it; unknown activity requires manual confirmation. See [restart requirements](docs/configuration.md#会话生成中与重启守卫).
- **Patch hosting (advanced):** `.dsh/patches/` syncs with the repository. Web checks and applies patches on startup and after syncing; Desktop does not apply these Web runtime patches.

## Data and privacy

The dedicated credentials file is excluded, but secrets written into conversations, attachments or project files can still be synced. Use [exclusion rules](docs/sync-content.md) to control what uploads. Sync propagates deletions and edits; keep separate backups of important data.

## Updates and help

The complete source ZIP contains all version-controlled files at the release tag, including tests, development check scripts and documentation. It excludes Git history, dependencies and local files outside the repository. The npm package follows the `files` list in `package.json`: runtime code, the desktop restart script and selected documentation; tests and development check scripts are excluded. Bundled validation records document historical checks, not additional real-device validation of the current version. See the [0.20.0 validation record](docs/release-0.20.0-validation.md) for the current scope.

Each new version includes Chinese release notes and a complete source ZIP on [GitHub Releases](https://github.com/dpskk2/dsh-chatsync/releases). To download the source, open a release and select `dsh-chatsync-vVERSION-source.zip` under **Assets**. Use the installation steps above or the update command below to install or update the plugin.

To update the plugin, run this command and restart DSH:

```sh
dsh plugin --profile web update @dpskk2/dsh-chatsync
```

On the desktop app, update through its bundled command runtime instead (quit the app first):

```powershell
& "$env:LOCALAPPDATA\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop update @dpskk2/dsh-chatsync
```

- Installation errors, missing Sync controls, failed uploads or missing conversations: see [Troubleshooting](docs/getting-started.md#常见问题).
- Proxies, custom repositories and other settings: see [Configuration](docs/configuration.md).
- Still stuck? [Report an issue](https://github.com/dpskk2/dsh-chatsync/issues/new/choose) with error details, removing private content and keys.

The linked guides are in Chinese. The plugin supports DSH's `web` profile and the desktop app's `desktop` profile, and declares DSH ≥ `0.1.5-rc.3` and Node.js ≥20; Node.js 24 is recommended. DSH Web `0.2.0-rc.1` has been tested. See the [validation record](docs/release-0.12.12-validation.md) for tested environments.

[Changelog](CHANGELOG.md) · [Development](CONTRIBUTING.md)
