import { isTailscaleAddress, parseBrowserTabs, tabAddress, tabLabel, tailscaleTabs } from './tabs';

const TAB = { id: 'A1', url: 'http://mac.tail1234.ts.net:3000/', title: 'Dev server', active: true };

describe('parsing the Tabs of a Browser', () => {
  it('gives each Tab in the order the Browser has them', () => {
    const other = { id: 'B2', url: 'https://example.com/', title: '', active: false };

    expect(parseBrowserTabs([TAB, other])).toEqual([TAB, other]);
  });

  it('gives no Tabs for a Window with no Browser', () => {
    expect(parseBrowserTabs([])).toEqual([]);
  });

  it('says where the answer is wrong', () => {
    expect(() => parseBrowserTabs({ tabs: [] })).toThrow('tabs: expected an array');
    expect(() => parseBrowserTabs([{ ...TAB, url: 3 }])).toThrow('tabs[0].url: expected a string');
  });
});

describe('a Tailscale address', () => {
  it.each([
    'http://mac.tail1234.ts.net:3000/',
    'https://MAC.tail1234.ts.net',
    'http://mac.tail1234.ts.net./path?q=1',
    'http://user@mac.tail1234.ts.net:8081/',
    'http://100.64.0.1/',
    'http://100.107.141.5:8080/index.html',
    'https://100.127.255.255',
  ])('is %s', (url) => {
    expect(isTailscaleAddress(url)).toBe(true);
  });

  it.each([
    'http://localhost:3000/',
    'http://127.0.0.1:3000/',
    'https://example.com/',
    'https://ts.net/',
    'https://example.com/?next=http://mac.tail1234.ts.net/',
    'https://mac.tail1234.ts.net.example.com/',
    'http://100.63.255.255/',
    'http://100.128.0.1/',
    'http://100.64.0.1.example.com/',
    'http://100.64.0/',
    'http://100.64.0.999/',
    'file:///100.64.0.1/index.html',
    'about:blank',
    '',
  ])('is not %s', (url) => {
    expect(isTailscaleAddress(url)).toBe(false);
  });

  it('keeps the Tabs at one, in the order they came in', () => {
    const tabs = [
      { ...TAB, id: '1', url: 'http://localhost:3000/' },
      { ...TAB, id: '2' },
      { ...TAB, id: '3', url: 'https://example.com/' },
      { ...TAB, id: '4', url: 'http://100.100.1.2:5173/' },
    ];

    expect(tailscaleTabs(tabs).map((tab) => tab.id)).toEqual(['2', '4']);
  });
});

describe('what a row says about a Tab', () => {
  it('is the title, and the host and port under it', () => {
    expect(tabLabel(TAB)).toBe('Dev server');
    expect(tabAddress(TAB)).toBe('mac.tail1234.ts.net:3000');
  });

  it('is the address for a page with no title yet', () => {
    expect(tabLabel({ ...TAB, title: ' ' })).toBe(TAB.url);
  });
});
