import type { Clock } from '@/lib/clock';
import { placeOwner } from '@/storage/records';

import { createLivePages } from './live-pages';

const URL = 'http://dev.tail0000.ts.net:3000/';
const START = { page: URL, scrollY: 0 };
const TOPIC_A = placeOwner('topic-a', 'main');
const TOPIC_B = placeOwner('topic-b', 'main');
const SESSION = placeOwner(null, 'main');

function clockAt(): Clock & { set(ms: number): void } {
  let now = 0;
  return { now: () => now, after: () => null, cancel: () => {}, set: (ms) => { now = ms; } };
}

function listed(topics: string[], sessions: string[]) {
  return { topics: new Set(topics), sessions: new Set(sessions) };
}

describe('Live Pages', () => {
  it('gives back the same page when its owner opens the Tab again', () => {
    const pages = createLivePages();
    const first = pages.open('host1', TOPIC_A, URL, START);
    expect(pages.open('host1', TOPIC_A, URL, { page: `${URL}later`, scrollY: 300 })).toBe(first);
    expect(pages.all()).toEqual([first]);
  });

  it('gives each owner its own page of the same Tab, so a form in one Topic is not in another', () => {
    const pages = createLivePages();
    const inA = pages.open('host1', TOPIC_A, URL, START);
    const inB = pages.open('host1', TOPIC_B, URL, START);
    const inSession = pages.open('host1', SESSION, URL, START);
    const onOtherHost = pages.open('host2', TOPIC_A, URL, START);
    expect(new Set([inA.id, inB.id, inSession.id, onOtherHost.id]).size).toBe(4);
  });

  it('releases a closed page, and opening the Tab again loads a new one', () => {
    const pages = createLivePages();
    const first = pages.open('host1', TOPIC_A, URL, START);
    const other = pages.open('host1', TOPIC_B, URL, START);
    pages.close(first.id);
    expect(pages.all()).toEqual([other]);
    expect(pages.open('host1', TOPIC_A, URL, START).id).not.toBe(first.id);
  });

  it('releases the pages of a Topic or Session that the Host no longer lists, on that Host only', () => {
    const clock = clockAt();
    const pages = createLivePages(clock);
    const closedTopic = pages.open('host1', TOPIC_A, URL, START);
    const openTopic = pages.open('host1', TOPIC_B, URL, START);
    const goneSession = pages.open('host1', placeOwner(null, 'old'), URL, START);
    const liveSession = pages.open('host1', SESSION, URL, START);
    const otherHost = pages.open('host2', TOPIC_A, URL, START);
    clock.set(10);
    pages.prune('host1', listed(['topic-b'], ['main']), 10);
    expect(pages.all()).toEqual([openTopic, liveSession, otherHost]);
    expect(pages.all()).not.toContain(closedTopic);
    expect(pages.all()).not.toContain(goneSession);
  });

  it('keeps a page opened after the Listing was received, whose Topic may be newer than it', () => {
    const clock = clockAt();
    const pages = createLivePages(clock);
    clock.set(20);
    const page = pages.open('host1', TOPIC_A, URL, START);
    pages.prune('host1', listed([], []), 10);
    expect(pages.all()).toEqual([page]);
  });

  it('releases every page of a deleted Host', () => {
    const pages = createLivePages();
    pages.open('host1', TOPIC_A, URL, START);
    pages.open('host1', SESSION, URL, START);
    const kept = pages.open('host2', TOPIC_A, URL, START);
    pages.releaseHost('host1');
    expect(pages.all()).toEqual([kept]);
  });

  it('tells its listeners when a page opens or is released, and not when nothing changes', () => {
    const pages = createLivePages();
    const heard = jest.fn();
    pages.subscribe(heard);
    const page = pages.open('host1', TOPIC_A, URL, START);
    pages.open('host1', TOPIC_A, URL, START);
    pages.prune('host1', listed(['topic-a'], []), 1_000);
    pages.close(page.id);
    pages.close(page.id);
    expect(heard).toHaveBeenCalledTimes(2);
  });
});
