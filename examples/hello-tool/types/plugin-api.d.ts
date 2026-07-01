export interface Platform {
  os: string;
  arch: string;
}

export interface Tool {
  name: string;
  commands: string[];
  displayName?: string;
  description?: string;
}

export interface ToolRelease {
  version: string;
  url: string;
  sha256: string;
  archiveFormat: "tar.gz" | "zip";
  stripComponents: number;
  commands: string[];
}

export type ListTools = () => Tool[];
export type ResolveTool = (tool: string, selector: string, platform: Platform) => ToolRelease;
export type ValidateInstalled = (tool: string, version: string, root: string) => boolean;
