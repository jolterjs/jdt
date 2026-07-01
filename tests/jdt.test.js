import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { spawnSync } from "node:child_process";

const root = path.resolve(".");
const cli = path.join(root, "src/cli.js");

test("jdt run executes the hello-tool example API", () => {
  const dir = copyExample("hello-tool");

  const list = runJdt(dir, ["run", "list-tools"]);
  assert.equal(list.status, 0, list.stderr);
  assert.deepEqual(
    JSON.parse(list.stdout),
    readJson(path.join(dir, "fixtures/list-tools.json")),
  );

  const resolved = runJdt(dir, [
    "run",
    "resolve-tool",
    "hello-tool",
    "1.x",
    "--os",
    "linux",
    "--arch",
    "x64",
  ]);
  assert.equal(resolved.status, 0, resolved.stderr);
  assert.deepEqual(
    JSON.parse(resolved.stdout),
    readJson(path.join(dir, "fixtures/resolve-tool.json")),
  );

  const valid = runJdt(dir, [
    "run",
    "validate-installed",
    "hello-tool",
    "1.2.3",
    dir,
  ]);
  assert.equal(valid.status, 0, valid.stderr);
  assert.equal(JSON.parse(valid.stdout), true);
});

test("jdt manifest and validate generate registry-compatible metadata", () => {
  const dir = copyExample("hello-tool");
  const wasm = path.join(dir, "fixture.wasm");
  fs.writeFileSync(wasm, Buffer.from("\0asm\x01\0\0\0", "binary"));

  assert.equal(runJdt(dir, ["build", "--wasm", wasm]).status, 0);
  const manifest = runJdt(dir, ["manifest", "--version", "1.2.3"]);
  assert.equal(manifest.status, 0, manifest.stderr);
  const validate = runJdt(dir, ["validate"]);
  assert.equal(validate.status, 0, validate.stderr);

  const release = readJson(path.join(dir, "dist/plugin.release.json"));
  assert.equal(release.name, "@jolter-example/hello-tool");
  assert.equal(release.version, "1.2.3");
  assert.equal(release.entrypoint.path, "plugin.wasm");
  assert.equal(release.provides.tools["hello-tool"].commands[0], "hello-tool");
  assert.match(release.artifacts.wasm.sha256, /^[a-f0-9]{64}$/);
});

test("jdt validate rejects unsafe command execution permissions", () => {
  const dir = copyExample("hello-tool");
  const plugin = readJson(path.join(dir, "plugin.json"));
  plugin.permissions.commands.execute = true;
  fs.writeFileSync(path.join(dir, "plugin.json"), JSON.stringify(plugin, null, 2));

  const result = runJdt(dir, ["validate"]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /does not allow shell execution/);
});

test("jdt run rejects invalid tool release output", () => {
  const dir = copyExample("hello-tool");
  fs.writeFileSync(
    path.join(dir, "src/plugin.ts"),
    `export function listTools() { return [{ name: "bad", commands: ["bad"] }]; }
export function resolveTool() { return { version: "not-semver", url: "http://example.test", sha256: "bad", archiveFormat: "tar.gz", stripComponents: 0, commands: ["bad"] }; }
`,
  );

  const result = runJdt(dir, ["run", "resolve-tool", "bad", "1"]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /version must be stable semver/);
});

test("jdt build compiles the hello-tool example when the component toolchain is available", {
  skip: !componentToolchainAvailable(),
  timeout: 60_000,
}, () => {
  const dir = copyExample("hello-tool");

  const result = runJdt(dir, ["build"]);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(path.join(dir, "dist/plugin.wasm")).subarray(0, 4).toString("binary"), "\0asm");
});

function copyExample(name) {
  const source = path.join(root, "examples", name);
  const destination = fs.mkdtempSync(path.join(os.tmpdir(), `jdt-${name}-`));
  fs.cpSync(source, destination, {
    recursive: true,
    filter: (file) => {
      const base = path.basename(file);
      return !["node_modules", "dist", ".jdt", "bun.lock"].includes(base);
    },
  });
  return destination;
}

function runJdt(cwd, args) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: "utf8",
  });
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function componentToolchainAvailable() {
  if (process.versions.bun && spawnSync("node", ["--version"], { encoding: "utf8" }).status !== 0) {
    return false;
  }
  const runtime = process.versions.bun ? "node" : process.execPath;
  const candidates = [
    path.join(root, "node_modules/@bytecodealliance/jco/src/jco.js"),
    path.join(root, "node_modules/@bytecodealliance/jco/bin/jco.js"),
    path.join(root, "node_modules/@bytecodealliance/jco/jco.js"),
  ];
  const script = candidates.find((candidate) => fs.existsSync(candidate));
  if (!script || !fs.existsSync(path.join(root, "node_modules/@bytecodealliance/componentize-js"))) {
    return false;
  }
  const result = spawnSync(runtime, [script, "--version"], {
    cwd: root,
    encoding: "utf8",
  });
  return result.status === 0;
}
