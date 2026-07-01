# Contributing

Thanks for helping improve the Jolter Development Toolkit.

## Development Setup

JDT uses Bun for local development and tests. Node.js is also required for
`jco componentize`, even when the CLI itself is run with Bun.

```bash
bun install
bun test
```

To try the example plugin end to end:

```bash
cd examples/hello-tool
bun install
bun jdt pack --version 1.0.0
```

## Project Layout

- `src/cli.js`: the `jdt` command implementation.
- `types/plugin-api.d.ts`: TypeScript types exposed to plugin authors.
- `wit/jolter-plugin.wit`: component interface used for plugin builds.
- `examples/hello-tool`: deterministic example used by tests.
- `tests`: CLI and example integration tests.

## Pull Requests

Before opening a pull request:

1. Run `bun test`.
2. Run `bun run format:check`.
3. Add or update tests when changing behavior.
4. Update the README or examples when user-facing behavior changes.

Keep pull requests focused. Small, well-described changes are easier to review
and safer to release.

## Commit Style

Use concise, imperative commit messages:

```text
Fix WIT type declarations
Add npm trusted publishing workflow
Document release process
```

## Reporting Bugs

Please use the bug report issue form and include:

- Your OS and architecture.
- Bun and Node.js versions.
- The exact `jdt` command you ran.
- The full error output.
- A small reproduction when possible.

## Security Issues

Do not open public issues for vulnerabilities. See `SECURITY.md`.
