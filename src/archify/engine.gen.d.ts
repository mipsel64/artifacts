export interface ArchifyEngineInstance {
  run(scriptPath: string, argv: string[]): Promise<void>;
  runtimeFiles: Record<string, string>;
}

export function instantiate(host: unknown): ArchifyEngineInstance;
