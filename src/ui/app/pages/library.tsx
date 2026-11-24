import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Icon as AstryxIcon } from '@astryxdesign/core/Icon';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { List, ListItem } from '@astryxdesign/core/List';
import { Heading, Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import type { ArtifactSummary } from '../../../types';
import { formatDate, retentionLabel } from '../../format';
import { Icon, TypeIcon } from '../icons';
import { usePreviewBridge } from '../preview';
import { expiresSoon, filterLibrary, type LibraryFilter } from './library-filter';
import { loadLibraryTitles } from './library-titles';

export interface LibraryProps {
  items: ArtifactSummary[];
  fullTitleIds: string[];
  now: string;
}

const FILTERS = [
  ['all', 'All'],
  ['shared', 'Shared'],
  ['expiring', 'Expiring soon'],
] as const satisfies ReadonlyArray<readonly [LibraryFilter, string]>;

type TitleLookup = 'idle' | 'pending' | 'failed' | 'ready';

// The SSR fallback is the direct-reader list. Only a desktop-sized hydrated client mounts the iframe.
let desktopMedia: MediaQueryList | undefined;
// A short landscape phone can pass the width threshold but should never show a quick look.
const getDesktopMedia = () => desktopMedia ??= window.matchMedia(
  '(min-width: 48rem) and (height > 30rem), (min-width: 48rem) and (pointer: fine)',
);
const getDesktopSnapshot = () => getDesktopMedia().matches;
const getServerSnapshot = () => false;
function subscribeDesktop(notify: () => void) {
  const media = getDesktopMedia();
  media.addEventListener('change', notify);
  return () => media.removeEventListener('change', notify);
}

function versionPath(route: 'a' | 'r', item: ArtifactSummary) {
  return `/${route}/${item.id}?v=${item.version}`;
}

function QuickLookFrame({ item }: { item: ArtifactSummary }) {
  const frame = useRef<HTMLIFrameElement>(null);
  usePreviewBridge(frame, { syncHash: false });
  return (
    <iframe
      ref={frame}
      data-artifact-preview
      className="library-preview-frame"
      src={versionPath('r', item)}
      title={`Preview of ${item.title}`}
      loading="lazy"
      sandbox="allow-scripts"
      inert
    />
  );
}

function QuickLook({ item, now, previewing, onPreview }: {
  item: ArtifactSummary | undefined;
  now: Date;
  previewing: boolean;
  onPreview: () => void;
}) {
  const panelRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const panel = panelRef.current;
    const bar = document.querySelector('.workspace-bar');
    if (!panel || !bar) return;
    // AppShell pins its header; account controls can make it wrap and grow.
    const header = bar.closest('header') ?? bar;
    const measure = () => panel.style.setProperty('--library-header-height', `${header.getBoundingClientRect().height}px`);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    return () => observer.disconnect();
  }, []);
  return (
    <aside ref={panelRef} className="library-quick" aria-labelledby="library-quick-label" tabIndex={0}>
      <header className="library-quick-header">
        <HStack gap={2} vAlign="center">
          <Icon name="frame" />
          <Text id="library-quick-label" weight="semibold">Quick look</Text>
        </HStack>
        {item && <Text className="library-serial" type="code" color="secondary">{item.type}</Text>}
      </header>
      {item ? (
        <>
          <VStack gap={3} padding={4} hAlign="start">
            <Text className="library-serial" type="code" color="secondary">Selected artifact</Text>
            <Heading level={2} className="library-caption-title">{item.title}</Heading>
            <dl className="library-facts">
              <VStack gap={0} hAlign="start">
                <dt>Access</dt>
                <dd>{item.shared ? 'Shared' : 'Private'}</dd>
              </VStack>
              <VStack gap={0} hAlign="start">
                <dt>Retention</dt>
                <dd>{retentionLabel(item.expiresAt, now)}</dd>
              </VStack>
              <VStack gap={0} hAlign="start">
                <dt>Version</dt>
                <dd>v{item.version}</dd>
              </VStack>
            </dl>
            <HStack gap={2} wrap="wrap">
              <Button
                label={previewing ? 'Hide preview' : 'Preview'}
                onClick={onPreview}
                aria-expanded={previewing}
                aria-controls={previewing ? 'library-preview-media' : undefined}
              />
              <Button label="Open artifact" href={versionPath('a', item)} variant="primary" endContent={<AstryxIcon icon="chevronRight" />} />
            </HStack>
          </VStack>
          {previewing && (
            <figure className="library-preview-media" id="library-preview-media">
              <QuickLookFrame key={`${item.id}:${item.version}`} item={item} />
            </figure>
          )}
        </>
      ) : (
        <VStack gap={2} padding={6}>
          <Text as="p" color="secondary">Select a matching artifact to see its preview.</Text>
        </VStack>
      )}
    </aside>
  );
}

function LibraryRow({ item, displayTitle = item.title, now, selected, onSelect }: {
  item: ArtifactSummary;
  displayTitle?: string;
  now: Date;
  selected: boolean;
  onSelect?: (id: string) => void;
}) {
  const selectRef = useRef<HTMLButtonElement>(null);
  const title = <Text weight="semibold" className="library-row-title" maxLines={1}>{displayTitle}</Text>;
  const retention = !onSelect || item.expiresAt === null || expiresSoon(item.expiresAt, now.getTime())
    ? retentionLabel(item.expiresAt, now)
    : null;
  return (
    <ListItem
      itemKey={item.id}
      {...(onSelect ? { interactiveRef: selectRef, isSelected: selected } : { href: `/a/${item.id}` })}
      startContent={
        <Text className={`library-type-tile artifact-type-${item.type}`}>
          <TypeIcon type={item.type} size={20} />
        </Text>
      }
      label={onSelect ? (
        <button
          ref={selectRef}
          type="button"
          className="library-row-select"
          title={displayTitle}
          aria-label={`Select ${displayTitle}`}
          aria-pressed={selected}
          onClick={() => onSelect(item.id)}
        >{title}</button>
      ) : title}
      description={
        <Text type="supporting" color="secondary">
          <Text className="library-row-kind" type="supporting">{item.type}</Text>
          {' · '}<time dateTime={item.updatedAt}>{formatDate(item.updatedAt)}</time>
          {' · '}v{item.version}
        </Text>
      }
      endContent={selected || item.shared || retention ? (
        <HStack gap={2} vAlign="center">
          {(item.shared || retention) && (
            <VStack gap={1} hAlign="end" className="library-row-flags">
              {item.shared && <Text type="supporting" color="secondary">Shared</Text>}
              {retention && <Text type="supporting" color="secondary">{retention}</Text>}
            </VStack>
          )}
          {selected && (
            <Button label="Open" aria-label={`Open ${displayTitle}`} href={versionPath('a', item)} variant="ghost" size="sm" />
          )}
        </HStack>
      ) : undefined}
    />
  );
}

export function Library({ items, fullTitleIds, now }: LibraryProps) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<LibraryFilter>('all');
  const [selectedId, setSelectedId] = useState<string>();
  const [previewPath, setPreviewPath] = useState<string>();
  const [nowDate, setNowDate] = useState(() => new Date(now));
  const [lookup, setLookup] = useState<TitleLookup>('idle');
  const [titles, setTitles] = useState<ReadonlyMap<string, string | null>>(() => new Map());
  const lookupRequest = useRef<AbortController | null>(null);
  const searchRef = useRef<HTMLElement>(null);
  const desktop = useSyncExternalStore(subscribeDesktop, getDesktopSnapshot, getServerSnapshot);
  const liveItems = useMemo(() => {
    const time = nowDate.getTime();
    return items.filter(({ id, expiresAt }) => titles.get(id) !== null && (expiresAt === null || Date.parse(expiresAt) > time));
  }, [items, titles, nowDate]);
  const sharedCount = useMemo(() => liveItems.filter((item) => item.shared).length, [liveItems]);
  const results = useMemo(() => filterLibrary(liveItems, query, filter, nowDate.getTime(), titles), [liveItems, query, filter, nowDate, titles]);
  const needsLookup = fullTitleIds.length > 0 && query.trim() !== '';
  const pendingSearch = needsLookup && lookup === 'pending';
  const failedSearch = needsLookup && lookup === 'failed';
  const selected = desktop ? results.find((item) => item.id === selectedId) ?? results[0] : undefined;
  const selectedTitle = selected && titles.get(selected.id);
  const selectedPreviewPath = selected && versionPath('r', selected);
  const previewing = previewPath !== undefined && previewPath === selectedPreviewPath;
  const totalLabel = `${liveItems.length} ${liveItems.length === 1 ? 'artifact' : 'artifacts'}`;

  useEffect(() => () => lookupRequest.current?.abort(), []);
  useEffect(() => {
    if (!previewing) setPreviewPath(undefined);
  }, [previewing]);

  const resolveTitles = () => {
    const unresolved = fullTitleIds.filter((id) => !titles.has(id));
    if (!unresolved.length) return;
    lookupRequest.current?.abort();
    const controller = new AbortController();
    lookupRequest.current = controller;
    setLookup('pending');
    void loadLibraryTitles(unresolved, controller.signal, (batch) => {
      setTitles((previous) => {
        const next = new Map(previous);
        for (const [id, title] of batch) next.set(id, title);
        return next;
      });
    }).then(
      () => { if (!controller.signal.aborted) setLookup('ready'); },
      () => { if (!controller.signal.aborted) setLookup('failed'); },
    );
  };

  const refreshTime = () => {
    // The server sampled `now` for this document, not when React finished hydrating.
    const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    const elapsed = Math.max(0, performance.now() - (navigation?.responseStart ?? 0));
    setNowDate(new Date(Date.parse(now) + elapsed));
  };

  const changeQuery = (value: string) => {
    setQuery(value);
    setPreviewPath(undefined);
    refreshTime();
    if (!value.trim()) {
      lookupRequest.current?.abort();
      lookupRequest.current = null;
      setLookup('idle');
    } else if (lookup === 'idle') {
      resolveTitles();
    }
  };

  const changeFilter = (value: LibraryFilter) => {
    setFilter(value);
    setPreviewPath(undefined);
    refreshTime();
  };

  const selectRow = (id: string) => {
    if (selected?.id !== id) setPreviewPath(undefined);
    setSelectedId(id);
  };

  const clearFilters = () => {
    changeQuery('');
    changeFilter('all');
    searchRef.current?.querySelector('input')?.focus();
  };

  return (
    <VStack gap={5} hAlign="stretch" className="library">
      <header className="library-mast">
        <VStack gap={1} hAlign="start">
          <Text type="code" color="secondary" className="library-kicker library-serial">Collection index</Text>
          <Heading level={1} className="library-title">Artifact library</Heading>
          <Text color="secondary">{totalLabel} · {sharedCount} shared</Text>
        </VStack>
        {items.length > 0 && (
          <search ref={searchRef} className="library-search" aria-label="Artifact library">
            <TextInput
              type="search"
              enterKeyHint="search"
              label="Search by title or type"
              isLabelHidden
              placeholder="Search by title or type"
              startIcon="search"
              value={query}
              onChange={changeQuery}
              hasClear
            />
          </search>
        )}
      </header>
      {items.length === 0 ? (
        <EmptyState
          title="No artifacts yet"
          headingLevel={2}
          description="Create one here, or let an agent create them over MCP."
          actions={
            <HStack gap={3} hAlign="center" wrap="wrap">
              <Button label="New artifact" href="/new" variant="primary" />
              <Button label="Connect an agent" href="/settings" />
            </HStack>
          }
        />
      ) : (
        <section className="library-work" data-desktop={desktop || undefined} aria-label="Collection">
          <VStack gap={0} hAlign="stretch" className="library-results">
            <section className="library-filters" aria-label="Filter artifacts">
              {FILTERS.map(([key, label]) => (
                <Button
                  key={key}
                  label={label}
                  variant={filter === key ? 'secondary' : 'ghost'}
                  aria-pressed={filter === key}
                  onClick={() => changeFilter(key)}
                />
              ))}
            </section>
            {failedSearch && (
              <HStack gap={2} vAlign="center" wrap="wrap" className="library-search-error">
                <Text role="alert" color="secondary">Some full titles could not be searched.</Text>
                <Button
                  label="Retry"
                  size="sm"
                  onClick={() => {
                    resolveTitles();
                    searchRef.current?.querySelector('input')?.focus();
                  }}
                />
              </HStack>
            )}
            {results.length > 0 ? (
              <List density="spacious" hasDividers edge="padded">
                {results.map((item) => (
                  <LibraryRow
                    key={item.id}
                    item={item}
                    displayTitle={titles.get(item.id) ?? undefined}
                    now={nowDate}
                    selected={selected?.id === item.id}
                    onSelect={desktop ? selectRow : undefined}
                  />
                ))}
              </List>
            ) : !pendingSearch && !failedSearch && (
              <EmptyState
                title={liveItems.length ? 'No matches' : 'No artifacts left'}
                headingLevel={2}
                description={liveItems.length ? 'Try another title, type, or filter.' : 'The listed artifacts have been deleted or expired.'}
                actions={liveItems.length ? <Button label="Clear filters" onClick={clearFilters} /> : undefined}
              />
            )}
            <footer className="library-footer">
              <Text role="status" type="supporting" color="secondary">
                {pendingSearch ? 'Searching full titles… ' : ''}{`${results.length} of ${totalLabel}`}
              </Text>
              <Text type="supporting" color="secondary">Newest first</Text>
            </footer>
          </VStack>
          {desktop && (
            <QuickLook
              item={selected && selectedTitle ? { ...selected, title: selectedTitle } : selected}
              now={nowDate}
              previewing={previewing}
              onPreview={() => setPreviewPath(previewing ? undefined : selectedPreviewPath)}
            />
          )}
        </section>
      )}
    </VStack>
  );
}
