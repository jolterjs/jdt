#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const command = process.argv[2] ?? "help";
const args = process.argv.slice(3);

try {
  if (command === "init") await init();
  else if (command === "build") await build();
  else if (command === "manifest") await manifest();
  else if (command === "pack") await pack();
  else if (command === "validate") await validateProject();
  else if (command === "run") await runPlugin();
  else {
    help();
    process.exit(command === "help" || command === "--help" ? 0 : 1);
  }
} catch (error) {
  logError(error.message);
  process.exit(1);
}

function help() {
  console.log(`jdt <command>

Commands:
  init                         Create a minimal Jolter plugin project
  build [--wasm file]          Compile JS/TS to dist/plugin.wasm
  manifest [--version x.y.z]   Generate dist/plugin.release.json and checksums
  pack [--version x.y.z]       Run build, manifest, and validate
  validate                     Validate manifests and WASM artifact metadata
  run list-tools               Run the local plugin API and print JSON
  run resolve-tool <tool> <selector> [--os os] [--arch arch]
  run validate-installed <tool> <version> <root>
`);
}

async function init() {
  writeIfMissing(
    "plugin.json",
    JSON.stringify(
      {
        $schema: "https://jolter.dev/schemas/plugin/v1/schema.json",
        schemaVersion: 1,
        name: "@example/example",
        displayName: "Example",
        description: "Example Jolter plugin.",
        repository: {
          type: "git",
          url: "https://github.com/example/jolter-plugin-example.git",
        },
        license: "MIT",
        readme: "./README.md",
        supports: { jolter: ">=0.3.0" },
        provides: {
          tools: {
            example: {
              displayName: "Example",
              description: "Example tool managed by a Jolter plugin.",
              commands: ["example"],
            },
          },
        },
      },
      null,
      2,
    ) + "\n",
  );
  writeIfMissing(
    "src/plugin.ts",
    `import type { Platform, Tool, ToolRelease } from "../types/plugin-api";

export function listTools(): Tool[] {
  return [{ name: "example", commands: ["example"] }];
}

export function resolveTool(tool: string, selector: string, platform: Platform): ToolRelease {
  if (tool !== "example") throw new Error("unsupported tool " + tool);
  return {
    version: selector === "latest" ? "1.0.0" : selector.replace(/\\.x$/, ".0"),
    url: "https://example.com/example-" + platform.os + "-" + platform.arch + ".tar.gz",
    sha256: "0".repeat(64),
    archiveFormat: "tar.gz",
    stripComponents: 1,
    commands: ["example"]
  };
}

export function validateInstalled(): boolean {
  return true;
}
`,
  );
  writeIfMissing("README.md", "# Example Jolter Plugin\n");
  copyToolkitFile("types/plugin-api.d.ts", "types/plugin-api.d.ts");
  copyToolkitFile("wit/jolter-plugin.wit", "wit/jolter-plugin.wit");
  logOk("Initialized Jolter plugin project.");
}

async function build(options = {}) {
  fs.mkdirSync("dist", { recursive: true });
  const explicit = valueAfter("--wasm") ?? process.env.JDT_WASM;
  if (explicit) {
    fs.copyFileSync(explicit, "dist/plugin.wasm");
    assertWasmMagic("dist/plugin.wasm");
    if (!options.quiet) logOk("Copied " + explicit + " to dist/plugin.wasm");
    return;
  }

  const source = sourceFile();
  const bundled = await bundleSource(source);
  const wit = firstExisting(["wit/jolter-plugin.wit", toolkitPath("wit/jolter-plugin.wit")]);
  const jco = jcoCommand();
  const result = spawnSync(
    jco.command,
    [
      ...jco.prefixArgs,
      "componentize",
      bundled,
      "--wit",
      wit,
      "--world-name",
      "jolter-plugin",
      "--out",
      path.resolve("dist/plugin.wasm"),
      "--disable",
      "all",
    ],
    { stdio: options.quiet ? "pipe" : "inherit", shell: false },
  );
  if (result.status !== 0 || !fs.existsSync("dist/plugin.wasm")) {
    const stderr = result.stderr ? String(result.stderr).trim() : "";
    throw new Error(
      "jco componentize failed" + (stderr ? ": " + stderr : "") + ". Install dependencies with `bun install` or `npm install`.",
    );
  }
  assertWasmMagic("dist/plugin.wasm");
  if (!options.quiet) logOk("Compiled dist/plugin.wasm");
}

async function manifest(options = {}) {
  const root = readRootManifest();
  const wasmPath = "dist/plugin.wasm";
  if (!fs.existsSync(wasmPath)) throw new Error("dist/plugin.wasm is missing; run jdt build first");
  const wasm = fs.readFileSync(wasmPath);
  const version = valueAfter("--version") ?? packageVersion() ?? "0.1.0";
  const tag = valueAfter("--tag") ?? "v" + version;
  const repo = githubRepo(root.repository?.url);
  const release = {
    $schema: "https://jolter.dev/schemas/plugin-release/v1/schema.json",
    schemaVersion: 1,
    name: root.name,
    version,
    repository: {
      type: "github",
      owner: repo.owner,
      repo: repo.repo,
    },
    release: {
      tag,
      commit: git(["rev-parse", "HEAD"]) ?? "UNKNOWN_COMMIT",
    },
    jolter: {
      minimumVersion: "0.3.0",
      apiVersion: "1",
    },
    entrypoint: {
      type: "wasm",
      path: "plugin.wasm",
    },
    provides: await providesForManifest(root),
    permissions: root.permissions ?? defaultPermissions(),
    artifacts: {
      wasm: {
        file: "plugin.wasm",
        sha256: sha256(wasm),
        size: wasm.length,
      },
    },
  };
  validateRelease(release);
  fs.mkdirSync("dist", { recursive: true });
  fs.writeFileSync("dist/plugin.release.json", JSON.stringify(release, null, 2) + "\n");
  fs.writeFileSync("dist/checksums.txt", `${release.artifacts.wasm.sha256}  plugin.wasm\n`);
  if (!options.quiet) logOk("Generated dist/plugin.release.json and dist/checksums.txt");
}

async function pack() {
  await build();
  await manifest();
  await validateProject();
}

async function validateProject() {
  const root = readRootManifest();
  validateRootManifest(root);
  const releasePath = "dist/plugin.release.json";
  if (fs.existsSync(releasePath)) {
    const release = readJson(releasePath);
    validateRelease(release);
    if (release.name !== root.name) throw new Error("release manifest name does not match root manifest");
    const wasmPath = path.join("dist", release.artifacts.wasm.file);
    if (!fs.existsSync(wasmPath)) throw new Error("release WASM artifact is missing: " + wasmPath);
    const wasm = fs.readFileSync(wasmPath);
    if (sha256(wasm) !== release.artifacts.wasm.sha256) {
      throw new Error("release WASM sha256 does not match artifact contents");
    }
    if (wasm.length !== release.artifacts.wasm.size) {
      throw new Error("release WASM size does not match artifact contents");
    }
  }
  logOk("Validated Jolter plugin project.");
}

async function runPlugin() {
  const action = args[0];
  if (!action) throw new Error("expected run action: list-tools, resolve-tool, or validate-installed");
  await ensureRunnableBundle();
  const plugin = await loadPluginModule();
  let output;
  if (action === "list-tools") {
    output = plugin.listTools();
    validateTools(output);
  } else if (action === "resolve-tool") {
    const [tool, selector] = [args[1], args[2]];
    if (!tool || !selector) throw new Error("usage: jdt run resolve-tool <tool> <selector>");
    const platform = {
      os: valueAfter("--os") ?? os.platform(),
      arch: valueAfter("--arch") ?? os.arch(),
    };
    output = plugin.resolveTool(tool, selector, platform);
    validateToolRelease(output);
  } else if (action === "validate-installed") {
    const [tool, version, root] = [args[1], args[2], args[3]];
    if (!tool || !version || !root) {
      throw new Error("usage: jdt run validate-installed <tool> <version> <root>");
    }
    output = Boolean(plugin.validateInstalled?.(tool, version, root));
  } else {
    throw new Error("unknown run action `" + action + "`");
  }
  console.log(JSON.stringify(output, null, 2));
}

async function ensureRunnableBundle() {
  await bundleSource(sourceFile());
}

async function loadPluginModule() {
  const modulePath = path.resolve(".jdt/build/plugin.js");
  const imported = await import(pathToFileURL(modulePath).href + "?t=" + Date.now());
  if (typeof imported.listTools !== "function") throw new Error("plugin must export listTools()");
  if (typeof imported.resolveTool !== "function") throw new Error("plugin must export resolveTool()");
  return imported;
}

async function providesForManifest(root) {
  if (root.provides) return root.provides;
  try {
    const plugin = await loadPluginModule();
    return {
      tools: Object.fromEntries(
        plugin.listTools().map((tool) => [
          tool.name,
          {
            displayName: tool.displayName ?? tool.name,
            description: tool.description ?? root.description ?? "",
            commands: tool.commands,
          },
        ]),
      ),
    };
  } catch {
    const slug = root.name.split("/").pop();
    return {
      tools: {
        [slug]: {
          displayName: root.displayName ?? slug,
          description: root.description ?? "",
          commands: [slug],
        },
      },
    };
  }
}

async function bundleSource(source) {
  fs.mkdirSync(".jdt/build", { recursive: true });
  const result = spawnSync(
    runtimeCommand(),
    [
      ...runtimePrefixArgs(),
      toolScript("esbuild/bin/esbuild"),
      source,
      "--bundle",
      "--platform=node",
      "--format=esm",
      "--outfile=.jdt/build/plugin.js",
      "--external:../types/plugin-api",
      "--log-level=warning",
    ],
    { stdio: "pipe", shell: false },
  );
  if (result.status !== 0) {
    throw new Error("esbuild failed: " + String(result.stderr || result.stdout).trim());
  }
  return path.resolve(".jdt/build/plugin.js");
}

function jcoCommand() {
  const node = nodeCommand();
  if (!node) {
    throw new Error(
      "jco componentize requires Node.js. Install Node.js or package a prebuilt component with `jdt build --wasm <file>`.",
    );
  }
  const script = firstExisting([
    "node_modules/@bytecodealliance/jco/src/jco.js",
    "node_modules/@bytecodealliance/jco/bin/jco.js",
    "node_modules/@bytecodealliance/jco/jco.js",
    toolkitPath("node_modules/@bytecodealliance/jco/src/jco.js"),
    toolkitPath("node_modules/@bytecodealliance/jco/bin/jco.js"),
    toolkitPath("node_modules/@bytecodealliance/jco/jco.js"),
  ]);
  if (script) {
    return {
      command: node,
      prefixArgs: [script],
    };
  }
  const binary = process.platform === "win32" ? "node_modules/.bin/jco.cmd" : "node_modules/.bin/jco";
  if (fs.existsSync(binary)) return { command: path.resolve(binary), prefixArgs: [] };
  return { command: "jco", prefixArgs: [] };
}

function nodeCommand() {
  if (process.env.JDT_NODE) return process.env.JDT_NODE;
  if (!process.versions.bun) return process.execPath;
  const probe = spawnSync("node", ["--version"], { encoding: "utf8" });
  return probe.status === 0 ? "node" : null;
}

function toolScript(relative) {
  const local = path.join("node_modules", relative);
  if (fs.existsSync(local)) return local;
  const toolkit = toolkitPath(path.join("node_modules", relative));
  if (fs.existsSync(toolkit)) return toolkit;
  return local;
}

function runtimeCommand() {
  return process.execPath;
}

function runtimePrefixArgs() {
  return [];
}

function sourceFile() {
  const source = firstExisting(["src/plugin.ts", "src/plugin.js"]);
  if (!source) throw new Error("No src/plugin.ts or src/plugin.js found");
  return source;
}

function validateRootManifest(root) {
  if (!/^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/.test(root.name ?? "")) {
    throw new Error("root manifest name must be a scoped Jolter plugin name");
  }
  if (root.schemaVersion !== 1) throw new Error("root manifest schemaVersion must be 1");
  if (!root.description) throw new Error("root manifest description is required");
  githubRepo(root.repository?.url);
  validateProvides(root.provides ?? {});
  if (root.permissions?.commands?.execute) {
    throw new Error("Jolter plugin v1 does not allow shell execution");
  }
}

function validateRelease(release) {
  if (!/^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/.test(release.name ?? "")) {
    throw new Error("release name must be a scoped Jolter plugin name");
  }
  if (!/^\d+\.\d+\.\d+$/.test(release.version ?? "")) {
    throw new Error("release version must be stable semver");
  }
  if (release.release?.tag !== "v" + release.version) {
    throw new Error("release tag must match v<version>");
  }
  if (release.entrypoint?.type !== "wasm") throw new Error("entrypoint type must be wasm");
  if (release.entrypoint.path !== release.artifacts?.wasm?.file) {
    throw new Error("entrypoint path must match WASM artifact file");
  }
  if (!/^[a-f0-9]{64}$/.test(release.artifacts?.wasm?.sha256 ?? "")) {
    throw new Error("WASM sha256 must be 64 lowercase hex characters");
  }
  if (!Number.isInteger(release.artifacts?.wasm?.size) || release.artifacts.wasm.size <= 0) {
    throw new Error("WASM size must be a positive integer");
  }
  validateProvides(release.provides ?? {});
  if (release.permissions?.commands?.execute) {
    throw new Error("Jolter plugin v1 does not allow shell execution");
  }
}

function validateProvides(provides) {
  for (const [tool, definition] of Object.entries(provides.tools ?? {})) {
    validateToolName(tool);
    validateCommands(definition.commands ?? []);
  }
}

function validateTools(value) {
  if (!Array.isArray(value)) throw new Error("listTools must return an array");
  for (const tool of value) {
    validateToolName(tool.name);
    validateCommands(tool.commands);
  }
}

function validateToolRelease(value) {
  if (!value || typeof value !== "object") throw new Error("resolveTool must return an object");
  if (!/^\d+\.\d+\.\d+$/.test(value.version ?? "")) throw new Error("tool release version must be stable semver");
  if (!String(value.url ?? "").startsWith("https://")) throw new Error("tool release url must be HTTPS");
  if (!/^[a-f0-9]{64}$/.test(value.sha256 ?? "")) throw new Error("tool release sha256 must be 64 lowercase hex characters");
  if (!["tar.gz", "zip"].includes(value.archiveFormat)) throw new Error("archiveFormat must be tar.gz or zip");
  if (!Number.isInteger(value.stripComponents) || value.stripComponents < 0) {
    throw new Error("stripComponents must be a non-negative integer");
  }
  validateCommands(value.commands);
}

function validateToolName(value) {
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(value ?? "")) {
    throw new Error("invalid tool name `" + value + "`");
  }
}

function validateCommands(commands) {
  if (!Array.isArray(commands) || commands.length === 0) {
    throw new Error("tool commands must be a non-empty array");
  }
  for (const command of commands) {
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(command)) {
      throw new Error("invalid command name `" + command + "`");
    }
  }
}

function readRootManifest() {
  return readJson(firstExisting(["plugin.json", "root.plugin.json"]));
}

function readJson(file) {
  if (!file) throw new Error("plugin.json or root.plugin.json was not found");
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function firstExisting(files) {
  return files.find((file) => fs.existsSync(file));
}

function writeIfMissing(file, contents) {
  if (fs.existsSync(file)) return;
  const directory = path.dirname(file);
  if (directory && directory !== ".") fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(file, contents);
}

function copyToolkitFile(from, to) {
  if (fs.existsSync(to)) return;
  const source = toolkitPath(from);
  if (!fs.existsSync(source)) return;
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(source, to);
}

function toolkitPath(relative) {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", relative);
}

function packageVersion() {
  if (!fs.existsSync("package.json")) return null;
  return JSON.parse(fs.readFileSync("package.json", "utf8")).version ?? null;
}

function valueAfter(flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : null;
}

function githubRepo(url) {
  const match = String(url ?? "").match(/^https:\/\/github\.com\/([^/\s]+)\/([^/\s.]+)(?:\.git)?\/?$/i);
  if (!match) throw new Error("repository.url must be a GitHub HTTPS URL");
  return { owner: match[1], repo: match[2].replace(/\.git$/i, "") };
}

function defaultPermissions() {
  return {
    network: { allowedHosts: [] },
    filesystem: { read: ["project"], write: ["jolter-cache", "jolter-tools"] },
    commands: { execute: false },
  };
}

function assertWasmMagic(file) {
  const magic = fs.readFileSync(file).subarray(0, 4).toString("binary");
  if (magic !== "\0asm") throw new Error(file + " is not a WebAssembly module or component");
}

function git(args) {
  const result = spawnSync("git", args, { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : null;
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function logOk(message) {
  console.log(formatStatus("OK", message, "\x1b[32m", process.stdout));
}

function logError(message) {
  console.error(formatStatus("ERR", message, "\x1b[31m", process.stderr));
}

function formatStatus(status, message, color, stream) {
  const label = shouldColor(stream) ? color + status + "\x1b[0m" : status;
  return label + " " + message;
}

function shouldColor(stream) {
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR && process.env.FORCE_COLOR !== "0") return true;
  return Boolean(stream.isTTY);
}
