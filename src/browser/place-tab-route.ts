import type { PlaceTab } from '@/storage/records';

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
