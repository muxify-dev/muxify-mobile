import { systemClock, type Clock } from '@/lib/clock';
import { sameOwner, type PlaceOwner, type PlaceTab } from '@/storage/records';

/**
 * One Live Page: the page the phone loaded for one Browser Tab of one owner,
 * a Topic or a Session with no Topic, on one Host.
 */
export interface LivePage {
  id: number;
  hostId: string;
  owner: PlaceOwner;
  /** The Host Tab's URL. With the Host and the owner, it is the key. */
  url: string;
  /** Where the page loads the first time: the Tab, or the page and offset of a Place. */
  start: Pick<PlaceTab, 'page' | 'scrollY'>;
  /** Clock milliseconds, which a Listing's receipt is compared with. */
  openedAt: number;
}

/** What the Host has, from one Listing. */
export interface ListedOwners {
  /** The ids of the open Topics. */
  topics: ReadonlySet<string>;
  /** The Sessions, live or Dormant on the Board. */
  sessions: ReadonlySet<string>;
}

/**
 * The Live Pages of the app. A Web View shows one; the others wait, loaded,
 * with their forms, sign-ins and scroll as the user left them.
 *
 * Hiding a page is not here: the Web View that shows it goes away, and the
 * page waits. Only these release one: `close` (the user closed it, or the
 * Host lists its Tab no more), `prune` (its owner is gone from the Host) and
 * `releaseHost` (the Host was deleted).
 */
export interface LivePages {
  /** The owner's page for this Tab, or null when it has none. */
  find(hostId: string, owner: PlaceOwner, url: string): LivePage | null;
  /** The owner's page for this Tab, loaded from `start` when it has none. */
  open(hostId: string, owner: PlaceOwner, url: string, start: LivePage['start']): LivePage;
  close(id: number): void;
  /**
   * Releases the pages of the Host's owners that a Listing received at
   * `readAt` does not have. A page opened after that Listing waits for the
   * next one: its Topic can be newer than the Listing.
   */
  prune(hostId: string, listed: ListedOwners, readAt: number): void;
  releaseHost(hostId: string): void;
  /** The same array until a page opens or is released. */
  all(): readonly LivePage[];
  /** Hears every change of `all()`. Answers the way to stop hearing. */
  subscribe(listener: () => void): () => void;
}

/** The owner's page for this Tab among `pages`, or null. */
export function findLivePage(pages: readonly LivePage[], hostId: string, owner: PlaceOwner, url: string): LivePage | null {
  return pages.find((page) => page.hostId === hostId && page.url === url && sameOwner(page.owner, owner)) ?? null;
}

export function createLivePages(clock: Clock = systemClock, say: (line: string) => void = () => {}): LivePages {
  let pages: readonly LivePage[] = [];
  let nextId = 1;
  const listeners = new Set<() => void>();

  function keep(kept: readonly LivePage[], why: string): void {
    if (kept.length === pages.length) return;
    for (const page of pages) if (!kept.includes(page)) say(`releasing the page of ${page.url} (${why})`);
    pages = kept;
    for (const listener of [...listeners]) listener();
  }

  return {
    find: (hostId, owner, url) => findLivePage(pages, hostId, owner, url),
    open(hostId, owner, url, start) {
      const found = findLivePage(pages, hostId, owner, url);
      if (found) return found;
      const page: LivePage = { id: nextId++, hostId, owner, url, start, openedAt: clock.now() };
      say(`a new page for ${url}`);
      pages = [...pages, page];
      for (const listener of [...listeners]) listener();
      return page;
    },
    close(id) {
      keep(pages.filter((page) => page.id !== id), 'closed');
    },
    prune(hostId, listed, readAt) {
      keep(pages.filter((page) =>
        page.hostId !== hostId
        || page.openedAt >= readAt
        || (page.owner.kind === 'topic' ? listed.topics.has(page.owner.topicId) : listed.sessions.has(page.owner.session))),
      'its owner is gone from the Host');
    },
    releaseHost(hostId) {
      keep(pages.filter((page) => page.hostId !== hostId), 'its Host was deleted');
    },
    all: () => pages,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}
