import { LIBRARY_TITLE_BATCH_SIZE, type LibraryTitleBatch } from '../../../types';

export async function loadLibraryTitles(
  ids: string[],
  signal: AbortSignal,
  onBatch: (titles: Array<readonly [string, string | null]>) => void,
): Promise<void> {
  let next = 0;
  let failed = false;
  let unauthorized = false;

  async function loadBatches() {
    while (next < ids.length && !signal.aborted && !unauthorized) {
      const batch = ids.slice(next, next + LIBRARY_TITLE_BATCH_SIZE);
      next += LIBRARY_TITLE_BATCH_SIZE;
      try {
        const response = await fetch(`/library/titles?ids=${batch.join(',')}`, { signal });
        if (response.status === 401 || response.status === 403) {
          unauthorized = true;
          return;
        }
        if (!response.ok) throw new Error('Could not load full artifact titles');
        const found = new Map((await response.json() as LibraryTitleBatch).map(({ id, title }) => [id, title]));
        signal.throwIfAborted();
        // An ID omitted by a successful response is missing, not a candidate for retry.
        onBatch(batch.map((id) => [id, found.get(id) ?? null] as const));
      } catch {
        failed = true;
      }
    }
  }

  await Promise.all([loadBatches(), loadBatches()]);
  signal.throwIfAborted();
  if (failed || unauthorized) throw new Error('Could not load full artifact titles');
}
