export const ARTIFACT_TYPES = ['html', 'react', 'svg', 'mermaid', 'markdown', 'code', 'slides', 'design', 'motion', 'archify'] as const;
export type ArtifactType = (typeof ARTIFACT_TYPES)[number];

// The reading font and size a viewer can choose in Settings; render documents expose them as --font and --font-size.
export const READING_FONTS = {
  serif: "ui-serif,'Iowan Old Style','Palatino Linotype',Palatino,Georgia,'Times New Roman',serif",
  sans: "system-ui,-apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif",
  mono: 'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace',
} as const;
export type ReadingFont = keyof typeof READING_FONTS;
export const READING_SIZES = [14, 15, 16, 17, 18, 20] as const;
export const DEFAULT_READING_SIZE = 16;

export interface SessionUser {
  id: string;
  email: string;
}

export interface Session extends SessionUser {
  hostedDomain: string | null;
}

export interface User extends SessionUser {
  name: string | null;
  avatarUrl: string | null;
  createdAt: string;
}

export interface VersionInfo {
  version: number;
  key: string;
  size: number;
  createdAt: string;
}

export interface ArtifactMeta {
  id: string;
  ownerId: string;
  title: string;
  type: ArtifactType;
  language: string | null;
  version: number;
  versions: VersionInfo[];
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
  shareId: string | null;
  shareAudience: string[] | null;
}

export interface ArtifactSummary {
  id: string;
  title: string;
  type: ArtifactType;
  version: number;
  updatedAt: string;
  expiresAt: string | null;
  shared: boolean;
}

export interface ArtifactView extends ArtifactMeta {
  url: string;
  renderUrl: string;
  shareUrl: string | null;
}

export type AppEnv = {
  Bindings: Env;
  Variables: { user: SessionUser; authMethod: 'session' | 'token' };
};
