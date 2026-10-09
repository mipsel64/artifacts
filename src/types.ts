export const ARTIFACT_TYPES = ['html', 'react', 'svg', 'mermaid', 'markdown', 'code'] as const;
export type ArtifactType = (typeof ARTIFACT_TYPES)[number];

export interface SessionUser {
  id: string;
  email: string;
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
  shareUrl: string | null;
}

export type AppEnv = {
  Bindings: Env;
  Variables: { user: SessionUser; authMethod: 'session' | 'token' };
};
