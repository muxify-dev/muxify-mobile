import type { LastPlace, PlaceTab } from '@/storage/records';

/**
 * The Web View of the Tab a Place has on top, at the page and offset
 * where it was left. It stands in the Terminal Screen's place, right over the
 * Host Screen, so the user sees one move to the page and Back goes to the
 * Host Screen. The Web View then checks that the Host still lists the Tab.
 */
export function placeTabRoute(tab: PlaceTab) {
  return {
    pathname: '/web-view',
    params: { url: tab.url, page: tab.page, scrollY: String(tab.scrollY), restored: '1' },
  } as const;
}

/**
 * The screen a cold start opens the Last Place on, over the Host Screen, from
 * the Tab its Place has (see placeOfLastPlace). A Place with a Tab opens its
 * Web View, which shows the Connection Screen while the reconnect runs: no
 * Terminal Screen comes first, so no Surface is mounted to size the Mac's
 * Window while only the page is ever shown. Any other Place opens the
 * Terminal Screen.
 */
export function coldStartRoute(last: LastPlace, tab: PlaceTab | null) {
  const opening = { hostId: last.hostId, session: last.session, ...(last.topicId ? { topicId: last.topicId } : {}), reconnect: '1' };
  if (!tab) return { pathname: '/terminal', params: opening } as const;
  const page = placeTabRoute(tab);
  return { pathname: page.pathname, params: { ...page.params, ...opening } } as const;
}
