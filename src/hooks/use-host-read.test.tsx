import React from 'react';
import { AccessibilityInfo } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { HostProblem } from '@/ssh/failures';
import { cancelOnAbort } from '@/ssh/host-server-channel';
import { fakeHostServer, refused } from '@/test-support/fake-host-server';

import { useHostRead, type HostReadHandle, type HostReadOptions } from './use-host-read';

/** A `go_to` request that the Host has not answered yet. */
interface Waiting {
  query: string;
  answer(rows: string[]): void;
  fail(error: unknown): void;
}

let server = fakeHostServer();
let waiting: Waiting[] = [];
let renderer: ReactTestRenderer;
let handle: HostReadHandle<string, string[]>;

const queries = (payloads: object[]) => payloads.map((payload) => (payload as { go_to: { query: string } }).go_to.query);
const reply = (query: string) => waiting.find((each) => each.query === query)!;

async function mount(options: Partial<HostReadOptions<string, string[]>> = {}) {
  function Screen() {
    handle = useHostRead<string, string[]>({
      read: (query, signal) => cancelOnAbort(server.server.request({ go_to: { query } }), signal) as Promise<string[]>,
      debounceMs: (query) => (query === '' ? 0 : 150),
      ...options,
    });
    return null;
  }
  await act(async () => { renderer = create(<Screen />); });
}

/** Asks for `query` and lets the Host answer it with `rows`. */
async function shown(query: string, ...rows: string[]) {
  await act(async () => { handle.ask(query); });
  await act(async () => { jest.advanceTimersByTime(150); });
  await act(async () => { reply(query).answer(rows); });
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
  server = fakeHostServer();
  waiting = [];
  server.answer = (payload) => new Promise((resolve, reject) => {
    waiting.push({ query: (payload as { go_to: { query: string } }).go_to.query, answer: resolve, fail: reject });
  });
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  jest.useRealTimers();
  jest.restoreAllMocks();
});

it('is pending in the render of the keystroke, keeps the last rows, and sends one read after the debounce', async () => {
  await mount();
  await shown('', 'muxify-mobile', 'muxify', 'dotfiles');

  act(() => { handle.ask('m'); });
  expect(handle.isPending).toBe(true);
  expect(handle.data).toEqual(['muxify-mobile', 'muxify', 'dotfiles']);
  expect(handle.dataKey).toBe('');

  await act(async () => { jest.advanceTimersByTime(100); });
  act(() => { handle.ask('mu'); });
  await act(async () => { jest.advanceTimersByTime(149); });
  expect(queries(server.requests)).toEqual(['']);

  await act(async () => { jest.advanceTimersByTime(1); });
  expect(queries(server.requests)).toEqual(['', 'mu']);
  expect(server.cancelled).toEqual([]);

  await act(async () => { reply('mu').answer(['muxify-mobile', 'muxify']); });
  expect(handle).toMatchObject({ isPending: false, data: ['muxify-mobile', 'muxify'], dataKey: 'mu' });
});

it('cancels a replaced read on the Host Server, and its late answer changes nothing', async () => {
  await mount();
  await shown('', 'muxify', 'dotfiles');
  await act(async () => { handle.ask('m'); jest.advanceTimersByTime(150); });
  await act(async () => { handle.ask('mu'); jest.advanceTimersByTime(150); });

  expect(queries(server.cancelled)).toEqual(['m']);

  await act(async () => { reply('m').answer(['late']); });
  expect(handle).toMatchObject({ isPending: true, data: ['muxify', 'dotfiles'], dataKey: '' });

  await act(async () => { reply('mu').answer(['muxify']); });
  expect(handle).toMatchObject({ isPending: false, data: ['muxify'], dataKey: 'mu' });
});

it('keeps the reason on screen while Try again runs at once, and ignores a second tap', async () => {
  await mount();
  await shown('', 'muxify');
  await act(async () => { handle.ask('m'); jest.advanceTimersByTime(150); });
  await act(async () => { reply('m').fail(refused('Dev Host refused the read.')); });
  const error = handle.error;
  expect(error).toMatchObject({ key: 'm', reason: expect.any(String) });
  expect(handle.data).toEqual(['muxify']);

  waiting = [];
  act(() => { handle.retry(); });
  expect(handle).toMatchObject({ isPending: true, error });
  act(() => { handle.retry(); });
  await act(async () => {});
  expect(queries(server.requests)).toEqual(['', 'm', 'm']);

  await act(async () => { reply('m').answer(['muxify']); });
  expect(handle).toMatchObject({ isPending: false, error: null, data: ['muxify'], dataKey: 'm' });
});

it('marks a failure that is a Host Problem, which the Connections keep', async () => {
  await mount();
  await act(async () => { handle.ask(''); });
  await act(async () => { reply('').fail(new HostProblem({ kind: 'unreachable', detail: 'Dev Host did not answer.' } as never)); });
  expect(handle).toMatchObject({ isPending: false, error: { key: '', reason: 'Dev Host did not answer.', hostProblem: true } });
});

it('gives Return the answer to the newest ask, and drops it for a newer keystroke or a failure', async () => {
  await mount();
  await shown('', 'dotfiles');
  const pick = jest.fn();

  await act(async () => { handle.ask('m'); handle.whenAnswered(pick); jest.advanceTimersByTime(150); });
  expect(pick).not.toHaveBeenCalled();
  await act(async () => { reply('m').answer(['muxify']); });
  expect(pick).toHaveBeenCalledWith(['muxify']);

  pick.mockClear();
  await act(async () => { handle.ask('mu'); handle.whenAnswered(pick); handle.ask('mux'); jest.advanceTimersByTime(150); });
  await act(async () => { reply('mux').answer(['muxify']); });
  expect(pick).not.toHaveBeenCalled();

  await act(async () => { handle.ask('x'); handle.whenAnswered(pick); jest.advanceTimersByTime(150); });
  await act(async () => { reply('x').fail(refused('no')); });
  expect(pick).not.toHaveBeenCalled();
});

it('cancels the read in flight when the screen cancels it or goes', async () => {
  await mount();
  await act(async () => { handle.ask(''); });
  await act(async () => { handle.cancel(); });
  expect(handle.isPending).toBe(false);
  await act(async () => { reply('').answer(['late']); });
  expect(handle.data).toBeUndefined();

  await act(async () => { handle.ask('m'); jest.advanceTimersByTime(150); });
  await act(async () => renderer.unmount());
  expect(queries(server.cancelled)).toEqual(['', 'm']);
});

it('says the result of a slow read to VoiceOver, and stays quiet for a fast one', async () => {
  await mount({ announce: (rows) => `${rows.length} results` });
  await shown('m', 'muxify');
  expect(AccessibilityInfo.announceForAccessibility).not.toHaveBeenCalled();

  await act(async () => { handle.ask('mu'); jest.advanceTimersByTime(1000); });
  await act(async () => { reply('mu').answer(['muxify', 'muxify-mobile']); });
  expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith('2 results');
});

it('holds an answer that would move the rows until the screen releases it', async () => {
  await mount({ hold: (shownNow) => shownNow !== null });
  await act(async () => { handle.seed('', ['kept']); handle.ask(''); });
  expect(handle.data).toEqual(['kept']);

  await act(async () => { reply('').answer(['fresh', 'kept']); });
  expect(handle).toMatchObject({ isPending: false, data: ['kept'], held: { key: '', data: ['fresh', 'kept'] } });

  act(() => { handle.release(); });
  expect(handle).toMatchObject({ data: ['fresh', 'kept'], held: null });
});
