import type { Host } from '@/storage/records';
import { createComposer } from '@/composer/composer';

import type { Attach, AttachState, LifecyclePhase } from './attach';
import { createAttachHolder, type AttachRequest } from './attach-holder';
import { EMPTY_TOPOLOGY } from './topology';

const host = (id: string): Host => ({
  id,
  displayName: id,
  address: '10.0.0.2',
  port: 22,
  identityId: 'identity-1',
});

/** An Attach that records what was done to it and nothing else. */
function fakeAttach(options: AttachRequest, log: string[]): Attach {
  let phase: AttachState['phase'] = { kind: 'connecting' };
  let destination = options.destination;
  log.push(`open ${options.host.id}:${options.destination.sessionName}`);
  const state = (): AttachState => ({
    phase,
    sessionName: destination.sessionName,
    topic: destination.topic ? { id: destination.topic.id, view: { kind: 'loading', last: destination.topic.seed } } : null,
    fingerprint: '',
    keyChanged: false,
    topology: EMPTY_TOPOLOGY,
    sessions: null,
    previews: new Map(),
    trouble: null,
    zoomed: options.zoomed,
    grid: null,
    scrolled: null,
    mouseTracking: false,
    cursorRow: null,
    alternate: false,
  });

  return {
    hostId: options.host.id,
    hostName: options.host.displayName,
    composer: createComposer(() => { throw new Error('no composer destination here'); }),
    state,
    subscribe: () => () => {},
    switchSession: async (next) => { destination = next; phase = { kind: 'connected' }; },
    selectWindow: () => Promise.resolve(),
    selectPane: () => false,
    split: () => Promise.resolve(),
    newWindow: () => Promise.resolve(),
    setZoom: () => {},
    capturePreviews: () => {},
    capturePaneText: () => Promise.resolve(''),
    paste: () => Promise.resolve(),
    clearPane: () => Promise.resolve(),
    refreshSessions: () => {},
    refreshTopology: () => {},
    refreshTopic: async () => {},
    reconnect: () => {},
    view: () => {
      throw new Error('no views here');
    },
    surfaceForPane: () => {},
    paneGridReported: () => {},
    windowGridReported: () => {},
    containerLaidOut: () => {},
    spanningSurface: () => {},
    sheetPresented: () => {},
    lifecycleChanged: (next: LifecyclePhase) =>
      log.push(`lifecycle ${options.destination.sessionName} ${next}`),
    close: () => {
      log.push(`close ${options.host.id}:${options.destination.sessionName}`);
      phase = { kind: 'closed' };
      return Promise.resolve();
    },
  };
}

function holderOn() {
  const log: string[] = [];
  const seen: (string | null)[] = [];
  const lastPlace = {
    forgetLastPlace: () => {
      log.push('forget Last Place');
      return Promise.resolve();
    },
  };
  const holder = createAttachHolder((options) => fakeAttach(options, log), lastPlace);
  holder.subscribe((attach) => seen.push(attach ? attach.state().sessionName : null));
  return { holder, log, seen };
}

describe('the one Attach the app holds', () => {
  it('opens a Session when nothing is attached', async () => {
    const { holder, log } = holderOn();
    await holder.open({ host: host('a'), destination: { sessionName: 'work', topic: null }, zoomed: true });

    expect(log).toEqual(['open a:work']);
    expect(holder.current()?.state().sessionName).toBe('work');
  });

  it('closes the attached Session before opening another', async () => {
    const { holder, log } = holderOn();
    await holder.open({ host: host('a'), destination: { sessionName: 'work', topic: null }, zoomed: true });
    await holder.open({ host: host('a'), destination: { sessionName: 'play', topic: null }, zoomed: true });

    // The order is the point: two Connections to account for is exactly what
    // holding one at a time is meant to avoid.
    // Opening another is not a Disconnect: the Last Place is kept until the
    // new Session arrives and replaces it.
    expect(log).toEqual(['open a:work', 'close a:work', 'open a:play']);
  });

  it('does the same for a Session on another Host', async () => {
    const { holder, log } = holderOn();
    await holder.open({ host: host('a'), destination: { sessionName: 'work', topic: null }, zoomed: true });
    await holder.open({ host: host('b'), destination: { sessionName: 'work', topic: null }, zoomed: true });

    expect(log).toEqual(['open a:work', 'close a:work', 'open b:work']);
  });

  it('opens nothing for the Session that is already attached', async () => {
    const { holder, log } = holderOn();
    const first = await holder.open({ host: host('a'), destination: { sessionName: 'work', topic: null }, zoomed: true });
    const again = await holder.open({ host: host('a'), destination: { sessionName: 'work', topic: null }, zoomed: true });

    expect(again).toBe(first);
    expect(log).toEqual(['open a:work']);
  });

  it('opens again for a Session that was closed under it', async () => {
    const { holder, log } = holderOn();
    const first = await holder.open({ host: host('a'), destination: { sessionName: 'work', topic: null }, zoomed: true });
    await first.close();
    log.length = 0;

    await holder.open({ host: host('a'), destination: { sessionName: 'work', topic: null }, zoomed: true });

    expect(log).toEqual(['close a:work', 'open a:work']);
  });

  it('ends it on purpose when asked, and holds nothing afterwards', async () => {
    const { holder, log, seen } = holderOn();
    await holder.open({ host: host('a'), destination: { sessionName: 'work', topic: null }, zoomed: true });
    await holder.disconnect();

    expect(log).toEqual(['open a:work', 'close a:work', 'forget Last Place']);
    expect(holder.current()).toBeNull();
    expect(seen).toEqual([null, 'work', null]);
  });

  it('has nothing to disconnect when nothing is attached', async () => {
    const { holder, log } = holderOn();
    await holder.disconnect();
    expect(log).toEqual([]);
  });
});

describe('the app’s lifecycle', () => {
  it('forwards it to whatever is attached', async () => {
    const { holder, log } = holderOn();
    await holder.open({ host: host('a'), destination: { sessionName: 'work', topic: null }, zoomed: true });
    log.length = 0;

    holder.lifecycleChanged('background');
    holder.lifecycleChanged('active');

    expect(log).toEqual(['lifecycle work background', 'lifecycle work active']);
  });

  it('is nobody’s business when nothing is attached', () => {
    const { holder, log } = holderOn();
    holder.lifecycleChanged('background');
    expect(log).toEqual([]);
  });
});


describe('reuse after an in-place Session switch', () => {
  it('uses the current Session instead of the first Session name', async () => {
    const { holder, log } = holderOn();
    const first = await holder.open({ host: host('a'), destination: { sessionName: 'work', topic: null }, zoomed: true });
    await first.switchSession({ sessionName: 'play', topic: null });
    const again = await holder.open({ host: host('a'), destination: { sessionName: 'play', topic: null }, zoomed: true });
    expect(again).toBe(first);
    expect(log).toEqual(['open a:work']);
    await holder.open({ host: host('a'), destination: { sessionName: 'work', topic: null }, zoomed: true });
    expect(first.state().sessionName).toBe('work');
    expect(log).toEqual(['open a:work']);
  });

  it('refuses a saved form result after its original Attach has changed', async () => {
    const { holder } = holderOn();
    const first = await holder.open({ host: host('a'), destination: { sessionName: 'work', topic: null }, zoomed: true });
    const replacement = await holder.open({ host: host('b'), destination: { sessionName: 'other', topic: null }, zoomed: true });
    await expect(holder.open({ host: host('a'), destination: { sessionName: 'made', topic: null }, zoomed: true,
      origin: { attach: first, sessionName: 'work', topicId: 'a' } })).rejects.toThrow('Session or Topic changed');
    expect(holder.current()).toBe(replacement);
  });
});


it('refuses a second open while the previous Attach closes', async () => {
  const { holder, log } = holderOn();
  const first = await holder.open({ host: host('a'), destination: { sessionName: 'work', topic: null }, zoomed: true });
  let release!: () => void;
  first.close = () => new Promise<void>((resolve) => { release = resolve; });
  const second = holder.open({ host: host('b'), destination: { sessionName: 'next', topic: null }, zoomed: true });
  await expect(holder.open({ host: host('c'), destination: { sessionName: 'third', topic: null }, zoomed: true })).rejects.toThrow('already being opened');
  release();
  await second;
  expect(holder.current()?.hostId).toBe('b');
  expect(log).toEqual(['open a:work', 'open b:next']);
});

it('does not open a Session after Disconnect during replacement', async () => {
  const { holder } = holderOn();
  const first = await holder.open({ host: host('a'), destination: { sessionName: 'work', topic: null }, zoomed: true });
  let release!: () => void;
  first.close = () => new Promise<void>((resolve) => { release = resolve; });
  const second = holder.open({ host: host('b'), destination: { sessionName: 'next', topic: null }, zoomed: true });
  const disconnecting = holder.disconnect();
  release();
  await disconnecting;
  await expect(second).rejects.toThrow('disconnected before');
  expect(holder.current()).toBeNull();
});

it('refuses a form opened over an Attach that no longer exists', async () => {
  const { holder } = holderOn();
  await expect(holder.open({ host: host('a'), destination: { sessionName: 'made', topic: null }, zoomed: true,
    origin: { attach: null, sessionName: null, topicId: 'a' } })).rejects.toThrow('Session or Topic changed');
  expect(holder.current()).toBeNull();
});


it('refuses an open until Disconnect has closed and forgotten Last Place', async () => {
  const log: string[] = [];
  let finishForget!: () => void;
  const holder = createAttachHolder((request) => fakeAttach(request, log), {
    forgetLastPlace: () => new Promise<void>((resolve) => { finishForget = resolve; }),
  });
  const first = await holder.open({ host: host('a'), destination: { sessionName: 'work', topic: null }, zoomed: true });
  let finishClose!: () => void;
  first.close = () => new Promise<void>((resolve) => { finishClose = resolve; });
  const ending = holder.disconnect();
  await Promise.resolve();
  const next = { host: host('b'), destination: { sessionName: 'next', topic: null }, zoomed: true };
  await expect(holder.open(next)).rejects.toThrow('disconnected');
  finishClose();
  await Promise.resolve();
  await expect(holder.open(next)).rejects.toThrow('disconnected');
  expect(holder.current()).toBeNull();
  finishForget();
  await ending;
  await holder.open(next);
  expect(holder.current()?.hostId).toBe('b');
});

it('refuses a cancelled delivery before closing its current Attach', async () => {
  const { holder, log } = holderOn();
  const first = await holder.open({ host: host('a'), destination: { sessionName: 'work', topic: null }, zoomed: true });
  await expect(holder.open({ host: host('b'), destination: { sessionName: 'next', topic: null }, zoomed: true,
    isCurrent: () => false })).rejects.toThrow('no longer current');
  expect(holder.current()).toBe(first);
  expect(log).toEqual(['open a:work']);
});

it('refuses a delivery cancelled while the previous Attach closes', async () => {
  const { holder, log } = holderOn();
  const first = await holder.open({ host: host('a'), destination: { sessionName: 'work', topic: null }, zoomed: true });
  let release!: () => void;
  first.close = () => new Promise<void>((resolve) => { release = resolve; });
  let current = true;
  const next = holder.open({ host: host('b'), destination: { sessionName: 'next', topic: null }, zoomed: true,
    isCurrent: () => current });
  current = false;
  release();
  await expect(next).rejects.toThrow('no longer current');
  expect(holder.current()).toBeNull();
  expect(log).toEqual(['open a:work']);
});

it('accepts a form from a plain Session and refuses it after that Session changes', async () => {
  const { holder } = holderOn();
  const first = await holder.open({ host: host('a'), destination: { sessionName: 'work', topic: null }, zoomed: true });
  const origin = { attach: first, sessionName: 'work', topicId: null };
  const made = { host: host('a'), destination: { sessionName: 'made', topic: null }, zoomed: true, origin };
  await holder.open(made);
  expect(holder.current()?.state().sessionName).toBe('made');
  await expect(holder.open(made)).rejects.toThrow('Session or Topic changed');
});

it('does not retain delivery guards in the new Attach', async () => {
  const create = jest.fn((request: AttachRequest) => fakeAttach(request, []));
  const holder = createAttachHolder(create, { forgetLastPlace: async () => {} });
  const request = { host: host('a'), destination: { sessionName: 'work', topic: null }, zoomed: true };
  await holder.open({ ...request, origin: { attach: null, sessionName: null, topicId: null }, isCurrent: () => true });
  expect(create).toHaveBeenCalledWith(request);
});
