# WuWiii Development Repository

This private repository contains the Electron desktop client, its shared
packages, tests, and local development configuration examples. It omits product
documentation, operational material, deployment instructions, and production
configuration.

WuWiii is derived from Project AIRI, copyright (c) 2024-PRESENT Neko Ayaka,
and retains its MIT License in [LICENSE](./LICENSE).

## Requirements

- Node.js 22 LTS
- pnpm 10.30.3, enabled through Corepack

## Local development

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

`pnpm dev` starts the desktop development app on port 5173. Its default cloud
API points to localhost. A packaged development build uses a separate app
identity and installation name. Copy only a relevant tracked environment
example when local configuration is needed, and keep credentials, personal
configuration, and generated files outside version control.

## Repository scope

See [DEVELOPMENT_REPOSITORY_SCOPE.md](./DEVELOPMENT_REPOSITORY_SCOPE.md) for
what this snapshot includes and excludes.

## License

The Project AIRI MIT license and attribution are retained in
[LICENSE](./LICENSE). Third-party font, asset, codec, and dependency notices
are retained with the distributable desktop resources in
[WUWIII-THIRD-PARTY-NOTICES.txt](./apps/stage-tamagotchi/build/WUWIII-THIRD-PARTY-NOTICES.txt)
and their applicable bundled license files.
