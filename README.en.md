# DSH 接着聊 · ChatSync

### Switch computers. Continue the conversation and the work.

[![npm](https://img.shields.io/npm/v/chatsync?color=2563eb)](https://www.npmjs.com/package/chatsync)
[![DSH](https://img.shields.io/badge/DSH-%E2%89%A50.2.0--rc.1-0f766e)](#compatibility)
[![MIT](https://img.shields.io/badge/license-MIT-slateblue)](LICENSE)

[Install](#install) · [Update](#update) · [中文](README.md) · [Source downloads](https://github.com/dpskk2/dsh-chatsync/releases/latest)

Requires DSH >= 0.2.0-rc.1 (Desktop 0.2.1-rc.2 or newer recommended) and Node.js >= 24. In Add Plugin, enter **chatsync**. The existing **@dpskk2/dsh-chatsync** package remains available for existing users.

For damaged legacy logs, incorrect project membership, local path collisions, or divergent offline conversations, use the separate on-demand data check. Repairs are previewed, backed up, and applied after DSH exits; independent conversations remain separate branches. See the [repair and branch guide](docs/data-repair-0.20.1.md) (Chinese).

Continue DeepSeek Harness sessions across Windows computers using your own **private GitHub repository**. Sync sessions, chat attachments, shareable settings and optional project files.

**0.20.1** is available as a package and full source archive on [GitHub Releases](https://github.com/dpskk2/dsh-chatsync/releases/tag/v0.20.1). Physical two-device acceptance has not passed (not performed); the owner explicitly requested release with this limitation. The same version is published to npm. See the [installation guide](docs/getting-started.md), [configuration and recovery](docs/configuration.md), and [validation record](docs/release-0.20.1-validation.md).

## Install

In DSH, open Plugins → Add Plugin and enter `chatsync`. Restart DSH after installation. Fully exit the desktop app, including its tray process.

Install [Git](https://git-scm.com/downloads/) and [GitHub CLI](https://cli.github.com/), then authorize GitHub:

```powershell
gh auth login --hostname github.com --git-protocol https --web
```

<details>
<summary>Install from PowerShell</summary>

Web:

```powershell
dsh plugin --profile web add chatsync
```

Windows Desktop (default installation path; fully exit first):

```powershell
& "$env:LOCALAPPDATA\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop add chatsync
```

</details>

Existing installations of `@dpskk2/dsh-chatsync` may keep using that package name. Do not install both names together. For local package installation, see the [installation guide](docs/getting-started.md).

![First setup in an isolated, fresh DSH profile](https://raw.githubusercontent.com/dpskk2/dsh-chatsync/main/docs/assets/readme/first-setup.jpg)

## Everyday use

Open **Sync** in the sidebar or Settings. First setup has three steps: set a backup destination, choose content, then sync. Run `gh auth login --hostname github.com --git-protocol https --web` to authorize GitHub. Keep the address empty to create or reuse a private dsh-sync repository on the first sync; saving alone does not create it. Configured users see automation status and **Sync now**. Sync settings and backup destination management stay visible; conflict contents expand on demand; session and data repairs open on a dedicated page. The default main branch is handled internally and existing custom branches are preserved. Grouping checks live in Sync settings. Ordinary ungrouped and archived sessions do not trigger repair; a notice requires inconsistent membership or evidence of grouping lost during sync. The notice shows the number of ungrouped sessions and opens a dedicated processing page. Select a session, review its plan, and choose an existing local project to recover a separate conversation while retaining and archiving the original. Other repair plans may require fully exiting DSH before writing. Sync settings also provide direct access to the processing page; background startup never closes the editor automatically.

New connections begin manually. Optional automation runs only at startup and after normal exit; there are no periodic or idle transfers during editing. Explicit existing startup, exit, pause and content choices are retained. A legacy manual configuration does not silently become automatic after upgrade. Closing the desktop window to the tray is not a full exit.

Content switches save immediately and reconcile failed or lost responses with effective settings. Credentials, proxies, local paths, locks and runtime state remain on their own computer. Turning a category off pauses both directions and preserves remote content.

## Data protection and recovery

Git fetch and merge use an isolated transport tree. Existing sessions are continued through public host persistence APIs, with writer ownership and fresh validation. Busy writers, divergent histories or missing capabilities retain originals and produce pending work; an explicit host-closed workflow is available when needed. Remote deletion does not directly delete local sessions.

Transfers inspect complete session snapshots and unpublished Git history. Connecting a repository and selecting content authorizes ordinary transfers; changed plugin manifests no longer require repeated approval. Startup sync runs in the background. New sessions, workspaces and drafts remain usable. An attempted send to an unchecked or unapplied old session opens a blocking dialog, retaining text and attachments. The user reviews updated history and sends again after sync; nothing is automatically resent. Failed startup sync retries in the background. The sidebar icon indicates activity; progress and feedback stay inside the Sync page without covering the account menu. Background sync has no cancellation button.

Conflict recovery preserves both originals, backs up project files before restoration, and can create a separate session through supported host APIs. Interrupted imports have bounded offline repair and rollback procedures. Format and host limitations are documented in the [configuration guide](docs/configuration.md).

Conflict records use a single file list with the path, time, merge result and a View content button. Originals open in a separate large dialog with highlighted differences, linked scrolling and difference navigation. Reference information is available in the [file catalog](docs/dsh-file-catalog.md) (Chinese).

This version supports GitHub only. GitCode and independent WebDAV backup are excluded. Update notices never install automatically.

## Development

Node.js 24 and Git are required. The source uses native ESM with no runtime npm dependencies:

```powershell
npm test
npm pack --dry-run
```

Tests must run from the source archive or checkout, not the npm installation. Unit tests, local Git fixtures, real host checks and physical two-computer acceptance are distinct evidence levels. See [validation](docs/release-0.20.1-validation.md), [contributing](CONTRIBUTING.md), and the [changelog](CHANGELOG.md).

License: [MIT](LICENSE)

## Update

Read the [changelog](CHANGELOG.md), update the installed profile, then restart DSH. Fully exit Windows Desktop before updating.

Web:

```powershell
dsh plugin --profile web update chatsync
```

Windows Desktop (default installation path):

```powershell
& "$env:LOCALAPPDATA\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop update chatsync
```

For an existing `@dpskk2/dsh-chatsync` installation, replace `chatsync` with that package name. Update reminders do not automatically install updates.

## Compatibility

DSH >= 0.2.0-rc.1; Desktop 0.2.1-rc.2 or newer recommended. Standalone use requires Node.js >= 24. Desktop uses its bundled runtime. See the [validation record](docs/release-0.20.1-validation.md) for the actual verification scope.
