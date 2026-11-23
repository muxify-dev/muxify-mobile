import { coldStartRoute } from './place-tab-route';

const TAB = { url: 'http://localhost:3000/', page: 'http://localhost:3000/docs', scrollY: 120 };
const LAST = { hostId: 'host1', session: 'main', topicId: null };

describe('coldStartRoute', () => {
  it('opens the Web View of a Place with a Tab, and no Terminal Screen', () => {
    expect(coldStartRoute(LAST, TAB)).toEqual({
      pathname: '/web-view',
      params: { url: TAB.url, page: TAB.page, scrollY: '120', restored: '1', hostId: 'host1', session: 'main', reconnect: '1' },
    });
  });

  it('keeps the Topic of a Last Place in a Topic', () => {
    expect(coldStartRoute({ ...LAST, topicId: 't1' }, TAB)).toEqual({
      pathname: '/web-view',
      params: { url: TAB.url, page: TAB.page, scrollY: '120', restored: '1', hostId: 'host1', session: 'main', topicId: 't1', reconnect: '1' },
    });
  });

  it('opens the Terminal Screen when the Place has no Tab', () => {
    expect(coldStartRoute(LAST, null)).toEqual({
      pathname: '/terminal',
      params: { hostId: 'host1', session: 'main', reconnect: '1' },
    });
  });
});
