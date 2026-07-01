# Jolter Development Toolkit

`@jolter/jdt` provides the `jdt` CLI for building, validating,
running, and packaging Jolter plugins.

## Quick Start

```bash
npm install -D @jolter/jdt
npx jdt init
npx jdt build
npx jdt run list-tools
npx jdt run resolve-tool example latest
npx jdt pack --version 1.0.0
```

`jdt pack` writes:

- `dist/plugin.wasm`
- `dist/plugin.release.json`
- `dist/checksums.txt`

## Commands

```bash
jdt init
jdt build
jdt build --wasm ./prebuilt.wasm
jdt manifest --version 1.2.3
jdt validate
jdt pack --version 1.2.3
jdt run list-tools
jdt run resolve-tool <tool> <selector> --os linux --arch x64
jdt run validate-installed <tool> <version> <root>
```

`jdt build` uses Bytecode Alliance `jco componentize` with
`@bytecodealliance/componentize-js`. Componentization currently requires
Node.js even when the rest of the toolkit is run with Bun. It fails if
compilation fails. Use `--wasm` only when
intentionally packaging a prebuilt artifact.

`jdt run` executes the local TypeScript/JavaScript plugin API and validates the
returned shape. It is a developer runner, not Jolter's production sandbox.

## Plugin API

Plugins export these functions from `src/plugin.ts` or `src/plugin.js`:

```ts
import type { Platform, Tool, ToolRelease } from "jolter-development-toolkit/types/plugin-api";

export function listTools(): Tool[] {
  return [{ name: "example", commands: ["example"] }];
}

export function resolveTool(tool: string, selector: string, platform: Platform): ToolRelease {
  return {
    version: "1.0.0",
    url: `https://example.com/${tool}-${platform.os}-${platform.arch}.tar.gz`,
    sha256: "0".repeat(64),
    archiveFormat: "tar.gz",
    stripComponents: 1,
    commands: [tool],
  };
}

export function validateInstalled(tool: string, version: string, root: string): boolean {
  return true;
}
```

Tool releases may return stable versions such as `1.0.0` or prerelease
versions such as `1.0.0-rc.1`. Plugin release manifests produced by
`jdt manifest` still use stable semver versions.

## Examples

- [`jolter-plugin-jolter`](https://github.com/jolterjs/jolter-plugin-jolter) The official Jolter Plugin for the Jolter runtime & tools manager.

## Development

```bash
bun install
bun test
bun run format:check
```

See `CONTRIBUTING.md` for contribution guidelines and local development notes.

## Releases

Publishing is handled by GitHub Actions and npm Trusted Publishing. To publish:

1. Update `package.json` and `CHANGELOG.md`.
2. Open and merge a pull request.
3. Create a GitHub release whose tag matches the package version, for example
   `v1.0.0`.

When the release is published, `.github/workflows/npm-publish.yml` verifies the
package and publishes it to npm with provenance using OIDC.
