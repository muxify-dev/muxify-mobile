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
  log.push(`open ${options.host.id}:${options.sessionName}`);
  const state = (): AttachState => ({
    phase,
    sessionName: options.sessionName,
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
    rowInSight: null,
  });

  return {
    hostId: options.host.id,
    hostName: options.host.displayName,
    composer: createComposer(() => { throw new Error('no composer destination here'); }),
    state,
    subscribe: () => () => {},
    switchSession: () => Promise.resolve(),
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
      log.push(`lifecycle ${options.sessionName} ${next}`),
    close: () => {
      log.push(`close ${options.host.id}:${options.sessionName}`);
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
    await holder.open({ host: host('a'), sessionName: 'work', topicId: null, zoomed: true });

    expect(log).toEqual(['open a:work']);
    expect(holder.current()?.state().sessionName).toBe('work');
  });

  it('closes the attached Session before opening another', async () => {
    const { holder, log } = holderOn();
    await holder.open({ host: host('a'), sessionName: 'work', topicId: null, zoomed: true });
    await holder.open({ host: host('a'), sessionName: 'play', topicId: null, zoomed: true });

    // The order is the point: two Connections to account for is exactly what
    // holding one at a time is meant to avoid.
    // Opening another is not a Disconnect: the Last Place is kept until the
    // new Session arrives and replaces it.
    expect(log).toEqual(['open a:work', 'close a:work', 'open a:play']);
  });

  it('does the same for a Session on another Host', async () => {
    const { holder, log } = holderOn();
    await holder.open({ host: host('a'), sessionName: 'work', topicId: null, zoomed: true });
    await holder.open({ host: host('b'), sessionName: 'work', topicId: null, zoomed: true });

    expect(log).toEqual(['open a:work', 'close a:work', 'open b:work']);
  });

  it('opens nothing for the Session that is already attached', async () => {
    const { holder, log } = holderOn();
    const first = await holder.open({ host: host('a'), sessionName: 'work', topicId: null, zoomed: true });
    const again = await holder.open({ host: host('a'), sessionName: 'work', topicId: null, zoomed: true });

    expect(again).toBe(first);
    expect(log).toEqual(['open a:work']);
  });

  it('opens again for a Session that was closed under it', async () => {
    const { holder, log } = holderOn();
    const first = await holder.open({ host: host('a'), sessionName: 'work', topicId: null, zoomed: true });
    await first.close();
    log.length = 0;

    await holder.open({ host: host('a'), sessionName: 'work', topicId: null, zoomed: true });

    expect(log).toEqual(['close a:work', 'open a:work']);
  });

  it('ends it on purpose when asked, and holds nothing afterwards', async () => {
    const { holder, log, seen } = holderOn();
    await holder.open({ host: host('a'), sessionName: 'work', topicId: null, zoomed: true });
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
    await holder.open({ host: host('a'), sessionName: 'work', topicId: null, zoomed: true });
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
