import type { ComponentType } from 'react';
import { Theme } from '@astryxdesign/core/theme';
import { defaultThemeSlug, themes } from '../../astryx-themes';
import { PAGES, type PageData, type PageName } from './pages';
import { FeedbackProvider, Shell } from './Shell';
import { ThemeModeProvider, useThemeMode } from './theme-mode';

function ThemedApp({ data }: { data: PageData }) {
  const { mode } = useThemeMode();
  const Page = PAGES[data.page] as ComponentType<Record<string, unknown>>;
  const props = data.props as Record<string, unknown>;
  return (
    <Theme theme={themes[defaultThemeSlug]} mode={mode}>
      <FeedbackProvider>
        <Shell shell={data.shell} page={data.page}><Page {...props} /></Shell>
      </FeedbackProvider>
    </Theme>
  );
}

export function App({ page, props, shell, mode }: { page: PageName; props: unknown; shell: PageData['shell']; mode: PageData['mode'] }) {
  return (
    <ThemeModeProvider initialMode={mode}>
      <ThemedApp data={{ page, props, shell, mode } as PageData} />
    </ThemeModeProvider>
  );
}
