import { parseBrowserTabs, reachability, reachableTabs, tabAddress, tabLabel } from './tabs';

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

describe('whether the phone can reach a Tab', () => {
  it.each([
    'http://mac.tail1234.ts.net:3000/',
    'https://MAC.tail1234.ts.net',
    'http://mac.tail1234.ts.net./path?q=1',
    'http://user@mac.tail1234.ts.net:8081/',
    'http://100.64.0.1/',
    'http://100.107.141.5:8080/index.html',
    'https://100.127.255.255',
  ])('%s is on the tailnet', (url) => {
    expect(reachability(url)).toBe('tailnet');
  });

  it.each([
    'https://github.com/',
    'https://GitHub.com/org/repo/pull/1',
    'http://user@github.com/',
    'https://github.com./',
    'https://ts.net/',
    'https://example.com/?next=http://localhost:3000/',
    'https://mac.tail1234.ts.net.example.com/',
    'http://100.64.0.1.example.com/',
    'https://localhost.example.com/',
    'http://8.8.8.8/',
    'http://100.63.255.255/',
    'http://100.128.0.1/',
    'http://172.15.0.1/',
    'http://172.32.0.1/',
    'http://192.169.0.1/',
  ])('%s is public', (url) => {
    expect(reachability(url)).toBe('public');
  });

  it.each([
    'http://localhost:3000/',
    'http://LOCALHOST:3000/',
    'http://localhost.:3000/',
    'http://app.localhost:3000/',
    'http://devbox:3000',
    'http://mac.local:8080/',
    'http://db.internal/',
    'http://router.home.arpa/',
    'http://127.0.0.1:3000/',
    'http://127.1.2.3/',
    'http://0.0.0.0:8000/',
    'http://10.0.0.5/',
    'http://172.16.0.1/',
    'http://172.31.255.255/',
    'http://192.168.1.10:8080/',
    'http://169.254.1.1/',
    'http://[::1]:3000/',
    'http://[fd7a:115c:a1e0::1]/',
  ])('%s is local to the Host', (url) => {
    expect(reachability(url)).toBe('hostLocal');
  });

  it.each([
    'about:blank',
    'file:///100.64.0.1/index.html',
    'chrome://settings',
    'ftp://github.com/',
    'http://100.64.0/',
    'http://100.64.0.999/',
    'http:///path',
    '',
  ])('%s is not a web page', (url) => {
    expect(reachability(url)).toBe('notWeb');
  });

  it('keeps the Tabs the phone can reach, in the order they came in', () => {
    const tabs = [
      { ...TAB, id: '1', url: 'http://localhost:3000/' },
      { ...TAB, id: '2' },
      { ...TAB, id: '3', url: 'https://github.com/' },
      { ...TAB, id: '4', url: 'about:blank' },
      { ...TAB, id: '5', url: 'http://100.100.1.2:5173/' },
    ];

    expect(reachableTabs(tabs).map((tab) => tab.id)).toEqual(['2', '3', '5']);
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
