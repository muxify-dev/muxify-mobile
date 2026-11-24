import { parseSessionPathRows, sessionPathRowsJson, type SessionPathRow } from '@/topics/session-paths';

import type { JsonFile } from './store';

/**
 * The last Session Paths each Host listed for an empty Go to field, so that
 * Go to has a list to show before the Host answers. It is a copy and not a
 * record: a file that cannot be read is an empty list, and the next answer of
 * the Host writes it again.
 */
export interface GoToCache<Row = SessionPathRow> {
  /** The rows the Host last listed, in its order, or none. */
  load(hostId: string): Promise<Row[]>;
  save(hostId: string, rows: readonly Row[]): Promise<void>;
  /** Drops a Host's rows, for a Host that is no longer saved. */
  forget(hostId: string): Promise<void>;
}

export function createGoToCache(file: JsonFile): GoToCache {
  return createListCache(file, parseSessionPathRows, sessionPathRowsJson);
}

export function createListCache<Row>(file: JsonFile, parse: (value: unknown) => Row[], encode: (rows: readonly Row[]) => unknown): GoToCache<Row> {
  let writes = Promise.resolve();
  function update(change: (byHost: Record<string, unknown>) => void) {
    const next = writes.then(async () => {
      const byHost = await read();
      change(byHost);
      await file.write(JSON.stringify(byHost));
    });
    writes = next.catch(() => {});
    return next;
  }
  async function read(): Promise<Record<string, unknown>> {
    try {
      const parsed: unknown = JSON.parse((await file.read()) ?? '{}');
      return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? { ...parsed } : {};
    } catch {
      return {};
    }
  }

  return {
    async load(hostId) {
      const byHost = await read();
      try {
        return Object.hasOwn(byHost, hostId) ? parse(byHost[hostId]) : [];
      } catch {
        return [];
      }
    },
    async save(hostId, rows) {
      await update((byHost) => { byHost[hostId] = encode(rows); });
    },
    async forget(hostId) {
      await update((byHost) => { delete byHost[hostId]; });
    },
  };
}
