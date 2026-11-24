import type { ArtifactSummary } from '../../../types';

export type LibraryFilter = 'all' | 'shared' | 'expiring';

const EXPIRY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export function expiresSoon(expiresAt: string | null, now: number): boolean {
  if (expiresAt === null) return false;
  const remaining = Date.parse(expiresAt) - now;
  return remaining > 0 && remaining <= EXPIRY_WINDOW_MS;
}

export function filterLibrary(
  items: ArtifactSummary[],
  query: string,
  filter: LibraryFilter,
  now: number,
  titles?: ReadonlyMap<string, string | null>,
): ArtifactSummary[] {
  const term = query.trim().toLowerCase();
  if (!term && filter === 'all') return items;
  return items.filter((item) => {
    if (filter === 'shared' && !item.shared) return false;
    if (filter === 'expiring' && !expiresSoon(item.expiresAt, now)) return false;
    return !term || `${titles?.get(item.id) ?? item.title} ${item.type}`.toLowerCase().includes(term);
  });
}
