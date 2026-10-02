<div align="center">

# DSH ChatSync

### Pick up where you left off.

Sync DeepSeek Harness (DSH) conversations, attachments, settings and project files across your computers.<br>
Your data stays in your own private GitHub repository.

[![npm](https://img.shields.io/npm/v/%40dpskk2%2Fdsh-chatsync?color=2563eb)](https://www.npmjs.com/package/@dpskk2/dsh-chatsync)
[![MIT](https://img.shields.io/badge/license-MIT-slateblue)](LICENSE)

[Get started](#before-you-start) · [Detailed guide](docs/getting-started.md) (Chinese) · [Source downloads](https://github.com/dpskk2/dsh-chatsync/releases/latest) · [Changelog](CHANGELOG.md) (Chinese) · [中文](README.md)

</div>

- **Synced:** conversations, attachments, model and interface settings, and workspace project files.
- **Set up separately:** model API keys, other plugins and project dependencies on each computer.
- **How syncing works:** sync on the original computer, then on the new one. Each sync retrieves remote data and uploads local changes.

## Before you start

Before you start: DSH ≥ `0.1.5-rc.3` opens normally, [Git](https://git-scm.com/downloads/) and [GitHub CLI](https://cli.github.com/) are installed, and GitHub is reachable.

### Install the plugin

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

<details>
<summary>Update the plugin</summary>

Fully quit Desktop (including its tray icon) before updating. Restart DSH after the update.

**Web:**

```powershell
dsh plugin --profile web update @dpskk2/dsh-chatsync
```

**Desktop:**

```powershell
& "$env:LOCALAPPDATA\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop update @dpskk2/dsh-chatsync
```

</details>

<details>
<summary>Uninstall the plugin</summary>

Fully quit Desktop (including its tray icon) before uninstalling. Restart DSH afterward.

**Web:**

```powershell
dsh plugin --profile web remove @dpskk2/dsh-chatsync
```

**Desktop:**

```powershell
& "$env:LOCALAPPDATA\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop remove @dpskk2/dsh-chatsync
```

</details>

### Sign in to GitHub

```sh
gh auth login --hostname github.com --git-protocol https --web
```

Complete browser authorization. Choose **Yes** when asked to authenticate Git with this account.

## First-time setup

After installation, restart DSH and open **设置 → 同步** (Settings → Sync). Follow the four steps shown there, starting on your original computer before connecting the new one.

### ① Connect a sync repository

- **First use:** leave the repository URL empty, keep **地址留空时自动创建或复用私有仓库** checked, and keep the branch as `main`. Sync will attempt to create or reuse your account's private `dsh-sync` repository.
- **Existing sync repository:** enter its URL and branch. On a new computer, use the URL and branch shown on the original computer.

Click **保存连接，继续第 2 步** (Save connection and continue).

**Note:** saving only stores the settings. Step ③ checks the connection and transfers data.

### ② Choose content and sync mode

Conversations, attachments, settings and workspace project files are synced by default. If you only need conversations and settings, turn off **同步工作区文件**. This pauses both upload and retrieval of project files; existing remote files remain but stop updating.

For first use, keep **手动同步** (Manual sync), then click **保存选择，继续第 3 步** (Save choices and continue).

**Note:** check sensitive files before your first sync. The dedicated credentials file is excluded, but secrets in conversations, attachments or project files can still be synced. Set [exclusion rules](docs/sync-content.md) first if needed.

### ③ Start syncing on your original computer

Click **立即同步** (Sync now) to retrieve remote data and upload local changes. Keep DSH open until the transfer finishes.

**Check the result:** the settings page should show a repository URL and a completed local sync, with no sync failures. A local snapshot alone means data has not been uploaded and cannot yet be retrieved on the new computer. On failure, open **上次同步详情** (Last sync details), resolve the issue and retry.

### ④ Retrieve and verify on your new computer

1. Install and sign in as described above, using the **same GitHub account**. Restart DSH, enter the **original computer's repository URL and branch**, and save the connection and content choices.
2. Click **立即同步** and confirm that the original conversations and selected project files appear. Restart DSH if grouping has not refreshed. To adjust a project path, click **换位置** under **本机新创建的工作区** (Workspaces created on this computer).
3. Create a test conversation on the new computer and sync. Return to the original computer, sync, and check that it appears there too. If syncing project files, also check both directions using a test file.

**Note:** Configure local model API keys and install other plugins and project dependencies on the new computer.

## Everyday use

**Sync before starting and after finishing; confirm success before switching computers.** Use **⟳ 同步** in the sidebar for everyday syncing.

Once the bidirectional check passes, select **自动同步** (Automatic sync) under **设置 → 同步 → 选择同步内容和方式**, enable **允许自动同步**, and save. The default interval is five minutes; session activity also triggers sync. See [Configuration](docs/configuration.md) for all triggers.

## Guides and help

The linked guides are in Chinese.

- **Installation and troubleshooting:** [tools, Desktop setup and common issues](docs/getting-started.md).
- **Switching computers:** [retrieval, project paths and dependencies](docs/getting-started.md#第二台电脑).
- **Sync settings:** [automatic sync, intervals, proxies and custom repositories](docs/configuration.md).
- **Sync scope:** [included data and exclusion rules](docs/sync-content.md).
- **Conflicts and recovery:** [merge rules and retained originals](docs/sync-content.md#合并与恢复边界).
- **Restarts after sync:** [automatic restart conditions and handling active conversations](docs/configuration.md#会话生成中与重启守卫).
- **Feedback:** [report an issue](https://github.com/dpskk2/dsh-chatsync/issues/new/choose) with error details, removing private content and keys.

Sync propagates deletions and edits; keep separate backups of important data.

[Changelog](CHANGELOG.md) · [Development](CONTRIBUTING.md)
