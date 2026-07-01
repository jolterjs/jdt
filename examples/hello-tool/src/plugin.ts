import type { Platform, Tool, ToolRelease } from "../../../types/plugin-api";

const versions = ["1.2.3", "1.1.0", "1.0.0"];

export function listTools(): Tool[] {
  return [
    {
      name: "hello-tool",
      displayName: "Hello Tool",
      description: "A deterministic fixture tool.",
      commands: ["hello-tool"],
    },
  ];
}

export function resolveTool(tool: string, selector: string, platform: Platform): ToolRelease {
  if (tool !== "hello-tool") {
    throw new Error("unsupported tool " + tool);
  }
  const version = selectVersion(selector);
  const platformKey = `${platform.os}-${platform.arch}`;
  return {
    version,
    url: `https://downloads.example.test/hello-tool/v${version}/hello-tool-${platformKey}.tar.gz`,
    sha256: "1".repeat(64),
    archiveFormat: "tar.gz",
    stripComponents: 1,
    commands: ["hello-tool"],
  };
}

export function validateInstalled(tool: string, version: string, root: string): boolean {
  return tool === "hello-tool" && versions.includes(version) && root.length > 0;
}

function selectVersion(selector: string): string {
  if (selector === "latest" || selector === "*" || selector.toLowerCase() === "x") {
    return versions[0];
  }
  const prefix = selector.replace(/\.x$/i, "");
  const selected = versions.find(
    (version) => version.startsWith(prefix + ".") || version === prefix,
  );
  if (!selected) throw new Error("no hello-tool version matches " + selector);
  return selected;
}
