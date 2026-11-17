import type { ComponentProps } from 'react';
import type { ShellProps } from './Shell';
import type { ThemeMode } from './mode';
import { Landing } from './pages/landing';
import { Restricted } from './pages/restricted';
import { ErrorPage } from './pages/error';
import { Consent } from './pages/consent';
import { AuthError } from './pages/auth-error';
import { Library } from './pages/library';
import { NewArtifact } from './pages/new-artifact';
import { EditArtifact } from './pages/edit-artifact';
import { Settings } from './pages/settings';
import { Viewer } from './pages/viewer';
import { Shared } from './pages/shared';

export const PAGES = {
  landing: Landing,
  library: Library,
  newArtifact: NewArtifact,
  editArtifact: EditArtifact,
  settings: Settings,
  viewer: Viewer,
  shared: Shared,
  restricted: Restricted,
  error: ErrorPage,
  consent: Consent,
  authError: AuthError,
} as const;

export type PageName = keyof typeof PAGES;
export type PageProps<N extends PageName> = ComponentProps<(typeof PAGES)[N]>;

export interface PageData<N extends PageName = PageName> {
  page: N;
  props: PageProps<N>;
  shell: ShellProps;
  mode: ThemeMode;
}
