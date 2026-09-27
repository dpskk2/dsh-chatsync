<div align="center">

# DSH ChatSync

### Pick up where you left off.

Bring your DeepSeek Harness (DSH) **conversations, attachments, settings and project files** to your other computers.
Your data stays in your own private GitHub repository.

[![npm](https://img.shields.io/npm/v/dsh-chatsync?color=2563eb)](https://www.npmjs.com/package/dsh-chatsync)
[![MIT](https://img.shields.io/badge/license-MIT-slateblue)](LICENSE)

[First-time setup](#first-time-setup) · [Another computer](#another-computer) · [Troubleshooting](#troubleshooting) · [中文](README.md)

</div>

**Once set up, you normally just click Sync.** The first setup involves installing two helper tools and signing in once. Follow the steps below; no programming knowledge is needed.

This plugin is for alternating between your own computers. Model API keys in the dedicated credentials file are not synced; configure them separately on each computer.

## First-time setup

### 1. Prepare the tools

First, make sure you can open the DSH web interface. If DSH is not installed, follow its [official setup instructions](https://github.com/deepseek-ai/deepseek-harness) and return here once it opens. If that setup asks for Node.js, [download it here](https://nodejs.org/en/download); version 24 is recommended.

| You need | What to do |
| --- | --- |
| A GitHub account | Holds your synced data. [Create an account](https://github.com/signup) if needed; use the same account on your other computers |
| Git | Transfers files and keeps versions. [Download Git](https://git-scm.com/downloads/) for your operating system and install it |
| GitHub CLI | Signs this computer in to GitHub. [Download GitHub CLI](https://cli.github.com/) for your operating system and install it |

Git and GitHub CLI are separate tools; install both. GitHub CLI does not have a separate sign-in window you need to find. The `gh` command below starts it from a terminal.

### 2. Open a terminal and install the plugin

After installing the tools, open a **new terminal window**:

- **Windows:** open Start, search for **PowerShell**, and open it normally; administrator mode is not needed.
- **macOS:** open the **Terminal** app.
- **Linux:** open your system's terminal.

Paste commands into that window, **not the DSH chat box or your browser's address bar**. Copy the whole line inside each code box, paste it, press Enter once, and wait for it to finish before continuing.

Install the plugin:

```text
dsh plugin --profile web add dsh-chatsync
```

Wait for the installation result and the input prompt to return. If it reports an error, use [Troubleshooting](#troubleshooting) before proceeding.

### 3. Sign this computer in

In the same terminal, paste this entire line and press Enter. It starts browser sign-in, with GitHub.com and HTTPS already selected:

```text
gh auth login --hostname github.com --git-protocol https --web
```

1. If asked whether to authenticate Git with your account, choose `Yes` and press Enter.
2. Note the one-time code shown in the terminal, then press Enter when prompted to open a browser. If the browser does not open, use the URL printed in the terminal.
3. Sign in to your GitHub account in the browser. Enter the **code from the terminal** when requested, then authorize GitHub CLI. This is not your model API key.
4. Return to the terminal and wait for sign-in to finish and the input prompt to return.

Now run this separate command to **check** the sign-in; it does not start another login:

```text
gh auth status
```

Look for `Logged in to github.com account` followed by your intended username. Being signed in on the website alone does not complete this step.

### 4. Return to DSH and sync

Stop and restart DSH, then refresh its web page. Refreshing the page alone does not restart DSH. If you launched DSH in a terminal, stop that process and start it again the way you normally do.

Open **设置 → 同步** (Settings → Sync):

1. **Choose what to upload.** Under **同步偏好**, workspace files are included by default. If you only want conversations, attachments and settings, turn off **同步工作区文件** and click **保存偏好**. A workspace is a project folder you opened in DSH.
2. **Leave the connection fields alone on your first setup.** Keep automatic repository creation enabled and click **立即同步**, or **⟳ 同步** in the sidebar. The plugin tries to create or reuse a private repository named `dsh-sync` under your account. Think of this as your cloud storage space; you do not need to create it manually first.
3. **Check the result.** The settings page should show a repository URL. Wait until syncing finishes, and check that neither the overall sync nor any workspace has failed.

A **local snapshot** means the data is saved on this computer only, not uploaded. Expand the sync error details and use the troubleshooting section if needed.

If you already have a specific repository, enter its URL and branch under **连接同步仓库** instead. Otherwise, follow the defaults above. [Custom repository guide](docs/getting-started.md#手动连接仓库) (Chinese).

## Another computer

**Sync successfully on the original computer first.** Then:

1. Repeat steps 1–3 above on the new computer: install the tools and plugin, and sign in with the **same GitHub account**.
2. Restart DSH, check the sync preferences, and click Sync. If you used the default repository on the original computer, the plugin will try to reuse it.
3. For a custom repository, copy the URL and branch from the original computer's sync settings into **连接同步仓库** on the new computer. Save, then sync; saving the address alone does not transfer anything.
4. After a successful sync, restart DSH again. Open a conversation from the original computer and check an attachment or project file to confirm that it arrived.
5. Configure your model API keys on this computer. Install other plugins and project dependencies as needed. If conversations appear but the model does not work, check credentials before syncing again.

You do not need to delete existing conversations or clone the data directory. Existing content participates in two-way merging. See the [recovery guide](docs/getting-started.md#第二台电脑) (Chinese) for dependencies and project paths.

## Everyday use

**Sync before starting and after finishing.** Check that changes on the previous computer were uploaded before switching devices.

For automatic syncing, choose automatic mode under **同步偏好** and save. It takes effect immediately, defaults to five-minute intervals, and responds to session activity. DSH must be running and the network available.

## What transfers?

| Synced | Set up on each computer |
| --- | --- |
| Conversations, attachments and workspace associations | Model API keys |
| Model settings, interface settings and plugin manifests | Other plugins and project dependencies |
| Actual workspace files, optionally | Project paths, if they need changing |

The dedicated credentials file is excluded, but secrets you put in conversations, attachments or project files can still be uploaded. Check the scope before your first sync. Sync also propagates deletions and mistakes; keep separate backups of important data. [Scope, exclusions and conflicts](docs/sync-content.md).

## Troubleshooting

| What you see | What to do first |
| --- | --- |
| `dsh`, `git` or `gh` is not recognized / `command not found` | Install the corresponding tool, then close and reopen the terminal. `gh` is GitHub CLI |
| Signed in on the website but not in the terminal | Complete the authorization started in step 3, then run `gh auth status` |
| No Sync section in settings | Check the plugin installation succeeded, restart the DSH process, then refresh the page |
| Local snapshot only or upload failure | Check sign-in, then read the error in sync settings. After failed automatic repository setup, wait about a minute before retrying |
| Conversations missing on the new computer | Sync the original computer first, then the new one; check matching repository and branch, then restart DSH |
| Network / proxy problem or still stuck | Read the [troubleshooting guide](docs/getting-started.md#常见问题) (Chinese), or [report an issue](https://github.com/dpskk2/dsh-chatsync/issues/new/choose) with redacted errors |

<details>
<summary>Requirements and more</summary>

The plugin uses DSH's `web` profile and declares DSH ≥ `0.1.5-rc.3`. Node.js ≥20 is declared; 24 is recommended for compressed sessions. See the [validation record](docs/release-0.12.5-validation.md) for tested environments and limits.

[Configuration](docs/configuration.md) · [Changelog](CHANGELOG.md) · [Development](CONTRIBUTING.md)

To update, run this line in a terminal, then restart DSH:

```text
dsh plugin --profile web update dsh-chatsync
```

</details>
