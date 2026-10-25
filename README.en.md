<div align="center">

# chatsync · Pick up where you left off
### Switch computers. Keep working.

Bring your DeepSeek Harness (DSH) sessions, attachments, settings and project files to another computer.<br>
Your data stays in your own **private GitHub repository**.

[![npm](https://img.shields.io/npm/v/chatsync?color=2563eb)](https://www.npmjs.com/package/chatsync)
[![DSH](https://img.shields.io/badge/DSH-%E2%89%A50.2.0--rc.1-0f766e)](#compatibility)
[![Desktop](https://img.shields.io/badge/Desktop-0.2.1--rc.3%20recommended-2563eb)](#compatibility)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A524-43853d)](#compatibility)
[![MIT](https://img.shields.io/badge/license-MIT-slateblue)](LICENSE)

[Installation](#installation) · [Updating](#updating) · [First setup](#first-setup) · [Moving to another computer](#moving-to-another-computer) · [Detailed guide](docs/getting-started.md) · [Releases and downloads](https://github.com/dpskk2/dsh-chatsync/releases/latest) · [中文](README.md)

</div>

## What chatsync can do

| Pick up where you left off | What gets synced |
| --- | --- |
| Continue the conversation | Session history, chat attachments and the links between sessions and workspaces |
| Continue the work | Documents, code and other files in your project folders |
| Set up less | Model and interface settings; keys, proxies and local paths stay on each computer |

## Installation

First, make sure DSH opens normally. Install [Git](https://git-scm.com/downloads/) and [GitHub CLI](https://cli.github.com/), and use a network connection that can reach GitHub.

Without a manually specified proxy, sync uses proxy environment variables first, then the current Windows system proxy. Changing the Windows proxy port requires no restart. Set a previously saved fixed proxy to an empty string or `auto` to enable automatic selection; see [proxy configuration](docs/configuration.md).

**Recommended: install in DSH.** Open **Plugins → Add Plugin** and enter `chatsync`.

You can also install from PowerShell:

**Web:**

```powershell
dsh plugin --profile web add chatsync
```

**Windows Desktop:**

This command uses the default installation location. Adjust the path if you installed DSH elsewhere.

```powershell
& "$env:LOCALAPPDATA\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop add chatsync
```

The previous package name, `@dpskk2/dsh-chatsync`, continues to receive the same versions. Existing installations can keep using it; there is no need to install both names.

You can also download a package from [GitHub Releases](https://github.com/dpskk2/dsh-chatsync/releases/latest) and follow the [local package installation guide](docs/getting-started.md#1-安装本地包).

## Updating

**If you originally installed `@dpskk2/dsh-chatsync`, replace `chatsync` in the commands with that package name.** Update notices can be turned off and never install updates automatically.

**Web:**

```powershell
dsh plugin --profile web update chatsync
```

**Windows Desktop:**

This command uses the default installation location. Adjust the path if you installed DSH elsewhere.

```powershell
& "$env:LOCALAPPDATA\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop update chatsync
```

## First setup

Restart DSH after installation. Click **Sync** in the sidebar, or open **Settings → Sync**.

**① Sign in to GitHub**

Run this in PowerShell and follow the prompts to authorize access in your browser:

```powershell
gh auth login --hostname github.com --git-protocol https --web
```

**② Backup destination** — Click **Use default backup and continue**. The first sync automatically creates or reuses the private `dsh-sync` repository. To use an existing repository, click **Use another repository**.

**③ Choose content** — Select what you need; changes save immediately. Start manually when first connecting, then enable automatic sync if you want it. [Full sync scope and exclusion rules](docs/sync-content.md)

**④ First sync** — Click **Sync now** and wait for it to finish. Confirm that the upload succeeded before switching computers; a local snapshot alone does not mean your data has been uploaded.

## Moving to another computer

1. After a successful sync on the original computer, install the plugin on the new computer and sign in to the same GitHub account.
2. Open **Sync** and use the default backup. For a custom repository, use the same repository and branch on both computers.
3. After syncing to retrieve your data, check your sessions, attachments and project files, and configure this computer's model API keys. If prompted to restart, fully exit DSH and open it again.

Other plugins and project dependencies need to be installed separately. If project folders are in different locations, adjust their local save locations in Sync settings. [Detailed guide](docs/getting-started.md#4-换台电脑接着使用)

## Everyday use

Click **Sync → Sync now** in the sidebar.

When automatic sync is enabled, it runs at startup and after a normal exit.

During startup sync, you can create sessions and workspaces and edit drafts as usual. If an older session asks you to wait, send again after verification finishes; your text and attachments are retained.

## Conflicts and repair

- **View conflicts:** Select a file and click **View content** to compare both originals. For project files, choose a version to restore; a divergent conversation can be saved as a separate session.
- **Session and data repair:** Open the processing page from Sync, review the checks, preview a plan and confirm. Repairs that require exiting DSH say so explicitly; originals and backups are retained.
- **Grouping checks:** If session grouping looks wrong, view the checks and proposed fixes on the Sync page.

[Conflicts and recovery](docs/configuration.md#冲突原件与项目文件恢复) · [Legacy data repair and session branches](docs/data-repair-0.20.1.md)

## Data and privacy

You are responsible for handling keys and other sensitive information written into chats, attachments or project files. Use [exclusion rules](docs/sync-content.md) to control what gets synced. Local credentials, locks, caches and runtime state are excluded from transfers.

Divergent conversations are retained as separate versions. Remote deletion does not directly delete local sessions. Keep separate backups of important material. [Sync and recovery boundaries](docs/configuration.md)

## Compatibility

Supports DSH Web and Windows Desktop, with a minimum version of **0.2.0-rc.1**. **Desktop 0.2.1-rc.3 or newer is recommended**. Standalone use requires **Node.js 24 or newer**; Desktop uses its bundled runtime.

See the [version validation record](docs/release-0.20.3-validation.md) for the environments actually tested and the remaining gaps.

## Help and development

[Installation and use](docs/getting-started.md) · [Configuration and recovery](docs/configuration.md) · [Sync scope](docs/sync-content.md) · [File catalog](docs/dsh-file-catalog.md) · [Report an issue](https://github.com/dpskk2/dsh-chatsync/issues)

Development requires Node.js 24 and Git. The source uses native ESM with no runtime npm dependencies:

```powershell
npm test
npm pack --dry-run
```

[Contributing](https://github.com/dpskk2/dsh-chatsync/blob/main/CONTRIBUTING.md) · [Changelog](CHANGELOG.md) · [MIT License](LICENSE)
