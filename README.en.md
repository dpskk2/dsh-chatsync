# ChatSync

Continue DeepSeek Harness sessions across Windows computers using your own **private GitHub repository**. Sync sessions, chat attachments, shareable settings and optional project files.

This workspace contains the consolidated **0.20.1 local build**. This delivery does not publish to npm or GitHub Releases. See the [installation guide](docs/getting-started.md), [configuration and recovery](docs/configuration.md), and [validation record](docs/release-0.20.1-validation.md).

## Everyday use

The first setup has three steps: connect a repository, choose content, then sync. Configured users enter a simple daily page with status and **Sync now**. Settings, conflict recovery, device receipts and diagnostics are available in expandable sections.

New connections begin manually. Optional automation runs only at startup and after normal exit; there are no periodic or idle transfers during editing. Explicit existing startup, exit, pause and content choices are retained. A legacy manual configuration does not silently become automatic after upgrade. Closing the desktop window to the tray is not a full exit.

Content switches save immediately and reconcile failed or lost responses with effective settings. Credentials, proxies, local paths, locks and runtime state remain on their own computer. Turning a category off pauses both directions and preserves remote content.

## Data protection and recovery

Git fetch and merge use an isolated transport tree. Existing sessions are continued through public host persistence APIs, with writer ownership and fresh validation. Busy writers, divergent histories or missing capabilities retain originals and produce pending work; an explicit host-closed workflow is available when needed. Remote deletion does not directly delete local sessions.

Transfers inspect complete session snapshots and unpublished Git history. First transfers, substantial deletion and settings or executable configuration changes require an explicit current preview. Cancellation stops at safe boundaries and cannot undo completed uploads or host writes.

Conflict recovery preserves both originals, backs up project files before restoration, and can create a separate session through supported host APIs. Interrupted imports have bounded offline repair and rollback procedures. Format and host limitations are documented in the [configuration guide](docs/configuration.md).

This version supports GitHub only. GitCode and independent WebDAV backup are excluded. Update notices never install automatically. Device receipts indicate content handoff, not successful use on another computer.

## Development

Node.js 24 and Git are required. The source uses native ESM with no runtime npm dependencies:

```powershell
npm test
npm pack --dry-run
```

Tests must run from the source archive or checkout, not the npm installation. Unit tests, local Git fixtures, real host checks and physical two-computer acceptance are distinct evidence levels. See [validation](docs/release-0.20.1-validation.md), [contributing](CONTRIBUTING.md), and the [changelog](CHANGELOG.md).

License: [MIT](LICENSE)
