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
- **Only need your chats?** Project files are included by default. Turn off **同步工作区文件** before your first sync to exclude them.

## What it does

Beyond syncing, the plugin handles a few things that make switching computers effortless:

- **Sessions stay grouped:** each conversation remembers its workspace, and that mapping syncs along with it — the sidebar grouping is identical on the other computer, with nothing stranded in "ungrouped".
- **Sync manually or automatically:** click **⟳ 同步** in the sidebar, or enable auto-sync (every 5 minutes, on session activity, and on exit) under Settings → Sync → Preferences.
- **Manage sessions:** the **归档会话** (Archived) section lists all sessions (including archived and ghost), with preview, unarchive and permanent delete.
- **Conflict handling:** append-only session histories are preserved verbatim. Divergent sessions retain one side, with both originals in Git history and recovery references shown in sync details. Settings merge field-by-field; ordinary file conflicts usually keep the local version.
- **Grouping self-repairs:** sessions pulled from sync are registered back into their workspace; if the sidebar still shows "ungrouped", restart DSH to rebuild the index. Automatic restart is off by default, applies only to Web, and requires a local Windows restart script; Desktop requires manual restart confirmation. See the [compatibility checks](docs/release-0.12.12-validation.md) for `session.v4.jsonl.zstd` coverage.
- **Patch hosting (advanced):** put node_modules patches under `.dsh/patches/` to sync them across machines; they are applied on startup and after every sync.

## First-time setup

### 1. Install and sign in

Make sure DSH Web works and both [Git](https://git-scm.com/downloads/) and [GitHub CLI](https://cli.github.com/) are installed. You also need a GitHub account and network access to GitHub.

Install the plugin in a terminal (PowerShell on Windows):

```sh
dsh plugin --profile web add @dpskk2/dsh-chatsync
```

Then sign in to GitHub, following the prompts to complete browser authorization:

```sh
gh auth login --hostname github.com --git-protocol https --web
```

Need help with installation or authorization? See the [detailed setup guide](docs/getting-started.md#环境准备) (Chinese).

### 2. Sync for the first time

Restart DSH, refresh the web page, and open **设置 → 同步** (Settings → Sync):

1. Check the sync scope. For conversations, attachments and settings only, turn off **同步工作区文件** and save preferences.
2. Keep the default connection settings and click **立即同步** (Sync now). The plugin tries to create or reuse a private repository named `dsh-sync` in your account; no manual repository setup is needed.
3. Wait for a successful upload and check that no workspace sync failed. **A local snapshot alone means your data has not been uploaded.**

Using a specific repository? Follow the [custom repository guide](docs/getting-started.md#手动连接仓库) to enter its URL and branch, then sync.

### 3. Switch computers

First, confirm that the original computer synced successfully. On the new computer, install the same tools and plugin, sign in with the **same GitHub account**, restart DSH, and sync. The default setup will try to reuse the same repository.

After retrieval succeeds, restart DSH again and configure your model API keys to continue your conversations. Install other plugins and project dependencies as needed. For a custom repository, use the same URL and branch as the original computer. [Migration and project paths](docs/getting-started.md#第二台电脑).

## Everyday use

**Sync before starting and after finishing.** Click **⟳ 同步** in the sidebar and confirm the upload succeeded before switching computers.

You can also enable automatic syncing under **设置 → 同步 → 同步偏好** and save. It defaults to five-minute intervals and responds to session activity. DSH must stay running with network access.

## Data and privacy

The dedicated credentials file is excluded, but secrets written into conversations, attachments or project files can still be synced. Use [exclusion rules](docs/sync-content.md) to control what uploads. Sync propagates deletions and edits; keep separate backups of important data.

## Updates and help

The complete source ZIP contains all version-controlled files at the release tag, including tests, development check scripts and documentation. It excludes Git history, dependencies and local files outside the repository. The npm package follows the `files` list in `package.json`: runtime code, the desktop restart script and selected documentation; tests and development check scripts are excluded. Bundled validation records document historical checks, not additional real-device validation of the current version. See the [0.12.13 validation record](docs/release-0.12.13-validation.md) for the current scope.

Each new version includes Chinese release notes and a complete source ZIP on [GitHub Releases](https://github.com/dpskk2/dsh-chatsync/releases). To download the source, open a release and select `dsh-chatsync-vVERSION-source.zip` under **Assets**. Use the installation steps above or the update command below to install or update the plugin.

To update the plugin, run this command and restart DSH:

```sh
dsh plugin --profile web update @dpskk2/dsh-chatsync
```

- Installation errors, missing Sync controls, failed uploads or missing conversations: see [Troubleshooting](docs/getting-started.md#常见问题).
- Proxies, custom repositories and other settings: see [Configuration](docs/configuration.md).
- Still stuck? [Report an issue](https://github.com/dpskk2/dsh-chatsync/issues/new/choose) with error details, removing private content and keys.

The linked guides are in Chinese. The plugin uses DSH's `web` profile and declares DSH ≥ `0.1.5-rc.3` and Node.js ≥20; Node.js 24 is recommended. DSH Web `0.2.0-rc.1` has been tested. See the [validation record](docs/release-0.12.12-validation.md) for tested environments.

[Changelog](CHANGELOG.md) · [Development](CONTRIBUTING.md)
