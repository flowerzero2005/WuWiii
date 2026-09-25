# WuWiii private development repository

This repository is a clean development snapshot. Its Git history starts here;
the earlier working repository and its environment files are not imported.

Included:

- The Electron desktop application and the shared packages it needs, including
  client-side server contracts and SDKs but no server implementation.
- Unit tests, package manifests, the lockfile, required assets and license
  notices, and safe local configuration examples.
- The root README and this scope statement, limited to safe local development
  information.

Excluded:

- The standalone documentation site and internal design, planning, memory,
  architecture, handoff, runbook, and operations material.
- The production server, background services, deprecated website, mobile app,
  demo apps, plugin examples, Tauri code, and unrelated tooling.
- Production environment files, provider keys, signing material, user data,
  database backups, and local development logs.
- Production operations and deployment runbooks, delivery archives, installers,
  bundled tools, model weights, and large demonstration media.
- Automatic deployment and release workflows. Pushing this repository cannot
  trigger the existing production deployment workflows.
- The production installer cleanup script and production application identity.
  Development packages use their own app identity and installation name.

Before granting anyone access, review the exact repository membership and
confirm that sharing the included source is intended. Repository privacy
controls access; it does not prevent an invited reader from copying code. The
root `LICENSE` retains the upstream license and attribution.
