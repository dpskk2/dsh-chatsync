<div align="center">

# DSH Sync

### Pick up where you left off.

Sync your [DeepSeek Harness][dsh] **sessions, attachments, settings and workspace files** across computers.
Your data lives in your own [private GitHub repository][private-repo]. Choose manual or automatic syncing.

[![npm](https://img.shields.io/npm/v/dsh-sync-plugin?color=2563eb)](https://www.npmjs.com/package/dsh-sync-plugin)
[![MIT](https://img.shields.io/badge/license-MIT-slateblue)](LICENSE)

[Get started](#get-started) · [Connect another computer](#connect-another-computer) · [Troubleshooting](#troubleshooting) · [中文](README.md)

</div>

## Get started

Already running [DSH Web][dsh]? Check these tools, then install the plugin. Starting from a fresh computer? Follow the [setup guide](docs/getting-started.md#环境准备) (Chinese).

| What you need | Why | Get it |
| --- | --- | --- |
| [DSH Web][dsh] | Runs the plugin in the `web` profile | [Official setup][dsh] |
| [Node.js][node] | Runtime; version 24 is recommended | [Download][node] |
| [Git][git] | Transfers files and keeps versions | [Download][git] |
| [GitHub account][github] + [GitHub CLI][gh] | Signs in and connects your private repository | [Create an account][signup] · [Install CLI][gh] |

### 1. Install the plugin

Open a terminal on the computer running [DSH][dsh]:

```sh
dsh plugin --profile web add dsh-sync-plugin
```

### 2. Sign in

Use [GitHub CLI][gh], choosing **[GitHub.com][github] → HTTPS** when prompted:

```sh
gh auth login
gh auth status
```

Confirm the signed-in account, then restart [DSH][dsh]. Need help? See the [login guide][login].

### 3. Click Sync

Before your first sync, open **Settings → Sync → 同步偏好** (Sync preferences). **Workspace files are included by default.** Turn off **同步工作区文件** if you only want sessions, attachments and settings.

Then click **⟳ 同步** in the sidebar:

| Your situation | What to do |
| --- | --- |
| You do not have a sync repository yet | Keep the defaults. The plugin tries to create or reuse a private repository under the signed-in account; the default name is `dsh-sync` |
| You already have a repository or want to choose one | Enter its URL and branch under **连接同步仓库**, save, then sync. [Create a private repository][new-repo] · [Connection guide](docs/getting-started.md#手动连接仓库) |

**Check the result:** Settings should show the intended repository and a completed sync without workspace errors. A **local snapshot** means the data was saved on this computer, not uploaded.

## Connect another computer

1. Install the tools and plugin from the [checklist above](#get-started). Sign in with [GitHub CLI][gh] using an account that can access your sync repository.
2. In **Settings → Sync → 连接同步仓库**, enter the **same URL and branch** as the original computer and save. The default repository can also be reused automatically under the same account.
3. Sync the original computer, then the new one. Restart [DSH][dsh] on the new computer to load the retrieved sessions and settings.
4. Configure API credentials and install the required plugin and project dependencies. Use **换位置** in the sync result to adjust workspace paths. [Recovery checklist](docs/getting-started.md#第二台电脑) (Chinese).

No manual clone of the data directory is needed. Existing data on the new computer participates in two-way merging. Saving a repository URL does not start a transfer.

## Everyday use

**Sync before starting and after finishing.** Before switching computers, check that your latest changes were uploaded.

For fewer clicks, select automatic mode in **同步偏好** and save. It takes effect immediately, defaults to a five-minute interval, and responds to session activity. The app must be running and the network available; a final manual sync lets you check the result before leaving.

## What comes along?

| Included | Handled on each computer |
| --- | --- |
| Sessions, attachments and workspace associations | API credentials: `.credentials.yaml` is excluded |
| Workspace files, optionally | Dependencies and caches such as `node_modules` |
| Model settings, interface settings and plugin manifests | Plugin dependency installation and local path adjustments |
| Patches you provide | Compatibility with the installed target files |

Other files, conversations or attachments may still contain secrets. Check the [scope and exclusions](docs/sync-content.md) before uploading. Sync propagates deletions and mistakes too; keep independent backups of important data.

<details>
<summary>Sync behavior and compatibility</summary>

Supported sessions and configuration files are merged automatically where possible. Ordinary-file conflicts may prefer the local version and attempt to back up remote history. Check the result and [merge boundaries](docs/sync-content.md#合并与恢复边界).

- Host declaration: [DSH Web][dsh] ≥ `0.1.5-rc.3`.
- Runtime: [Node.js][node] ≥20; 24 recommended for Zstandard support in compressed session handling.
- Cloud transfer: [Git][git], authenticated [GitHub CLI][gh], and access to [GitHub][github].
- See the [validation record](docs/release-0.12.5-validation.md) for test coverage and unverified environments.

</details>

## Troubleshooting

| Problem | Where to go |
| --- | --- |
| No Sync button | [Installation and restart checks](docs/getting-started.md#环境准备) |
| Login failure or local snapshots only | [Login help][login] · [Connection troubleshooting](docs/getting-started.md#常见问题) |
| Missing sessions on another computer | [Recovery checklist](docs/getting-started.md#第二台电脑) |
| Network or proxy problems | [Configuration reference](docs/configuration.md) |
| Excluding files or projects | [Sync scope](docs/sync-content.md) |
| Still stuck | [Report an issue](https://github.com/dpskk2/dsh-sync-plugin/issues/new/choose) with versions, steps and redacted errors |

The detailed guides linked above are currently in Chinese.

## Updates and more

```sh
dsh plugin --profile web update dsh-sync-plugin
```

Restart [DSH][dsh] after updating. [Changelog](CHANGELOG.md) · [Setup guide](docs/getting-started.md) · [Configuration](docs/configuration.md) · [Development](CONTRIBUTING.md) · [npm package](https://www.npmjs.com/package/dsh-sync-plugin)

[dsh]: https://github.com/deepseek-ai/deepseek-harness
[node]: https://nodejs.org/en/download
[git]: https://git-scm.com/downloads/
[github]: https://github.com/
[signup]: https://github.com/signup
[gh]: https://cli.github.com/
[login]: https://cli.github.com/manual/gh_auth_login
[new-repo]: https://github.com/new
[private-repo]: https://docs.github.com/en/repositories/creating-and-managing-repositories/about-repositories
