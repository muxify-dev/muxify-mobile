import { createTestClock, type TestClock } from '@/lib/test-clock';
import { MissingCredentialError } from '@/ssh/failures';
import type { Host } from '@/storage/records';
import type { HostStore } from '@/storage/store';

import { openAttach, type Attach, type AttachState, type HostConnection } from './attach';
import { GRID_SETTLE_MS } from './client-sizing';
import type { PaneSurface } from './pane-view';
import type { ControlChannel, ControlChannelEvents, TmuxTransport } from './transport';
import type { Grid } from './tmux-client';

const HOST: Host = {
  id: 'host-1',
  displayName: 'Dev Host',
  address: '10.0.0.2',
  port: 22,
  identityId: 'identity-1',
};

const GRID: Grid = { cols: 49, rows: 41 };
const PHONE = { width: 390, height: 780 };

/** Lets every queued promise run. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 40; turn += 1) await Promise.resolve();
}

/**
 * A tmux that answers the control protocol, driven line by line from the test.
 *
 * Below the transport seam, so nothing here is asserted for its own sake: it
 * exists so the Attach can be fed exactly what a real tmux sends.
 */
function fakeHost() {
  const commands: string[] = [];
  let events: ControlChannelEvents | null = null;
  let channelOpen = false;
  let attachCommand = '';
  let replies = 0;
  /** What `list-windows`, `list-panes` and the rest answer with. */
  const answers = new Map<string, string[]>([
    [
      'list-windows',
      ['@0\t0\t1\t2\t0\tshell\tzsh'],
    ],
    ['list-panes', ['0\t%0\tzsh\t1\t/home/user\tb25d,49x41,0,0,0']],
    ['list-sessions', ['work\t1']],
    ['display-message', ['0\t0\t0\t100\t49\t41\t0']],
  ]);
  /** Commands the Host refuses, by their first word. */
  const refusing = new Set<string>();

  const transport: TmuxTransport = {
    exec: () => Promise.reject(new Error('the Control Connection does not exec')),
    openControl(command, channelEvents): Promise<ControlChannel> {
      attachCommand = command;
      events = channelEvents;
      channelOpen = true;
      return Promise.resolve({
        write: (bytes) => {
          for (const line of new TextDecoder().decode(bytes).split('\n')) {
            if (line.trim() === '') continue;
            commands.push(line);
            answer(line);
          }
        },
        isOpen: () => channelOpen,
        close: async () => {
          channelOpen = false;
        },
      });
    },
  };

  function say(text: string): void {
    events?.onData(new TextEncoder().encode(text).buffer as ArrayBuffer);
  }

  function answer(line: string): void {
    replies += 1;
    const verb = verbOf(line);
    if (refusing.has(verb)) {
      say(`%begin 1 ${replies} 1\nthe Host refused ${verb}\n%error 1 ${replies} 1\n`);
      return;
    }
    const lines = answers.get(verb) ?? [];
    say(`%begin 1 ${replies} 1\n${lines.map((each) => `${each}\n`).join('')}%end 1 ${replies} 1\n`);
  }

  return {
    transport,
    commands,
    get attachCommand() {
      return attachCommand;
    },
    get channelOpen() {
      return channelOpen;
    },
    /** The `%begin`/`%end` pair tmux answers the attach with. */
    accept: () => say('%begin 1 1 0\n%end 1 1 0\n'),
    /** tmux refusing the attach, in its own words. */
    refuse: (message: string) => say(`%begin 1 1 1\n${message}\n%error 1 1 1\n`),
    notify: (text: string) => say(`${text}\n`),
    /** tmux letting go: the Session was killed, or the server went. */
    exit: (reason: string) => say(`%exit ${reason}\n`),
    /** The link underneath disappearing. */
    drop(): void {
      channelOpen = false;
      events?.onClosed(undefined);
    },
    /** The socket dying while the app is suspended, unheard. */
    dieQuietly(): void {
      channelOpen = false;
    },
    refuseCommand: (verb: string) => refusing.add(verb),
    /** What a command answers with, for a Window shaped differently. */
    answering: (verb: string, lines: string[]) => answers.set(verb, lines),
    verbs: () => commands.map(verbOf),
  };
}

/** The tmux command a rendered Control Command line runs, without its quoting. */
function verbOf(line: string): string {
  return (line.split(' ')[0] ?? '').replace(/'/g, '');
}

function fakeStore() {
  const wrote: string[] = [];
  const store: HostStore = {
    load: () =>
      Promise.resolve({ hosts: [HOST], identities: [], fingerprints: [], recentSessions: [] }),
    saveHost: () => Promise.reject(new Error('not used here')),
    removeHost: () => Promise.resolve(),
    credentialFor: () => Promise.resolve('secret'),
    rememberFingerprint: (hostId, value) => {
      wrote.push(`fingerprint ${hostId} ${value}`);
      return Promise.resolve();
    },
    fingerprintFor: () => Promise.resolve(undefined),
    rememberSession: (hostId, name) => {
      wrote.push(`session ${hostId} ${name}`);
      return Promise.resolve();
    },
    forgetSession: () => Promise.resolve(),
    recentSessionsFor: () => Promise.resolve([]),
  };
  return { store, wrote };
}

/**
 * An Attach against a tmux the test drives, with the Surface already reporting.
 *
 * `hosts` is a list because a replacement opens a *new* link: each connect
 * takes the next one, so a reconnect can be given a Host that behaves
 * differently from the one that dropped.
 */
function attachOn(
  options: {
    hosts?: ReturnType<typeof fakeHost>[];
    failLink?: () => unknown;
    sessionName?: string;
    zoomed?: boolean;
  } = {},
) {
  const hosts = options.hosts ?? [fakeHost()];
  const { store, wrote } = fakeStore();
  const clock = createTestClock();
  const seen: AttachState[] = [];
  const opened: ReturnType<typeof fakeHost>[] = [];

  let next = 0;
  const attach = openAttach({
    host: HOST,
    sessionName: options.sessionName ?? 'work',
    zoomed: options.zoomed ?? true,
    store,
    clock,
    openConnection: (): Promise<HostConnection> => {
      const failure = options.failLink?.();
      if (failure) return Promise.reject(failure);
      const host = hosts[Math.min(next, hosts.length - 1)];
      next += 1;
      opened.push(host);
      return Promise.resolve({
        transport: host.transport,
        fingerprint: 'SHA256:abcdef',
        verdict: { kind: 'first-sight' },
        close: () => Promise.resolve(),
      });
    },
  });

  attach.subscribe((state) => seen.push(state));

  return {
    attach,
    hosts,
    opened,
    store,
    wrote,
    clock,
    seen,
    phases: () => seen.map((state) => state.phase.kind),
  };
}

/** Everything up to and including a connected phase, on the first Host. */
async function connected(kit: ReturnType<typeof attachOn>, at = 0): Promise<void> {
  kit.attach.containerLaidOut(PHONE);
  kit.attach.windowGridReported(GRID, PHONE);
  kit.clock.advance(GRID_SETTLE_MS * 2);
  await settle();
  kit.hosts[at].accept();
  await settle();
}

function fakeSurface(): PaneSurface & { written: Uint8Array[] } {
  const written: Uint8Array[] = [];
  let focused = false;
  return {
    written,
    write: (bytes) => written.push(bytes),
    focus: () => {
      focused = true;
    },
    blur: () => {
      focused = false;
    },
    isFocused: () => Promise.resolve(focused),
  };
}

describe('the order an Attach happens in', () => {
  it('connects, checks the key, settles the grid, opens, sizes, zooms, reads', async () => {
    const kit = attachOn();

    // Nothing is opened until a grid has stopped moving: the Window must not
    // be laid out for a Surface that is still being measured.
    await settle();
    expect(kit.hosts[0].attachCommand).toBe('');

    kit.attach.windowGridReported({ cols: 32, rows: 11 }, PHONE);
    kit.clock.advance(6);
    kit.attach.windowGridReported(GRID, PHONE);
    kit.clock.advance(GRID_SETTLE_MS * 2);
    await settle();

    expect(kit.hosts[0].attachCommand).toContain('-C');
    expect(kit.wrote).toContain('fingerprint host-1 SHA256:abcdef');

    kit.hosts[0].accept();
    await settle();

    // Size first, so the capture that follows is of a Pane the size of the
    // Surface; then Zoom, then the Topology, then the Session list.
    expect(kit.hosts[0].verbs()).toEqual([
      // Size first, then the Zoom preference — read, then applied because this
      // Window was not zoomed — then the Topology, then the Session list.
      'refresh-client',
      'list-windows',
      'resize-pane',
      'list-windows',
      'list-panes',
      'list-sessions',
    ]);
    // The pre-layout grid never reached tmux.
    expect(kit.hosts[0].commands[0]).toContain("'-C' '49x41'");
  });

  it('publishes connecting and then connected', async () => {
    const kit = attachOn();
    await connected(kit);
    expect(kit.phases()[0]).toBe('connecting');
    expect(kit.phases()[kit.phases().length - 1]).toBe('connected');
    expect(kit.attach.state().sessionName).toBe('work');
  });

  it('stamps the Session as recently opened, once it actually opened', async () => {
    const kit = attachOn();
    expect(kit.wrote).not.toContain('session host-1 work');
    await connected(kit);
    expect(kit.wrote).toContain('session host-1 work');
  });

  it('ends in a disconnected phase carrying tmux’s own words for a refusal', async () => {
    const kit = attachOn();
    kit.attach.windowGridReported(GRID, PHONE);
    kit.clock.advance(GRID_SETTLE_MS * 2);
    await settle();

    kit.hosts[0].refuse("can't find session: work");
    await settle();

    const phase = kit.attach.state().phase;
    expect(phase.kind).toBe('disconnected');
    if (phase.kind !== 'disconnected') throw new Error('expected disconnected');
    expect(phase.reason.kind).toBe('session-ended');
    expect(phase.reason.detail).toContain("can't find session");
  });

  it('says a Host it could not reach is a Host it could not reach', async () => {
    const kit = attachOn({ failLink: () => Object.assign(new Error('no route'), {}) });
    await settle();

    const phase = kit.attach.state().phase;
    if (phase.kind !== 'disconnected') throw new Error('expected disconnected');
    expect(phase.reason.kind).toBe('host-unreachable');
  });

  it('never reaches the Host for a credential that is not there', async () => {
    const kit = attachOn({ failLink: () => new MissingCredentialError() });
    await settle();

    const phase = kit.attach.state().phase;
    if (phase.kind !== 'disconnected') throw new Error('expected disconnected');
    expect(phase.reason.kind).toBe('authentication');
  });
});

describe('the verbs', () => {
  it.each([
    ['selecting a Pane in another Window', (attach: Attach) => attach.selectWindow(3)],
    ['splitting', (attach: Attach) => attach.split('right')],
    ['adding a Window', (attach: Attach) => attach.newWindow()],
  ])('re-applies Zoom and reads the Topology after %s', async (_what, run) => {
    const kit = attachOn();
    await connected(kit);
    kit.hosts[0].commands.length = 0;

    await run(kit.attach);
    await settle();

    // The Zoom preference is read and re-applied, then the Topology is read
    // again: selecting a Pane drops tmux out of zoom, and moving to another
    // Window lands on one nobody has zoomed.
    expect(kit.hosts[0].verbs().slice(1)).toEqual([
      'list-windows',
      'resize-pane',
      'list-windows',
      'list-panes',
    ]);
  });

  it('re-sizes and stamps the Recent Session when the Session is switched', async () => {
    const kit = attachOn();
    await connected(kit);
    kit.hosts[0].commands.length = 0;
    kit.wrote.length = 0;

    await kit.attach.switchSession('play');
    await settle();

    expect(kit.attach.state().sessionName).toBe('play');
    expect(kit.wrote).toContain('session host-1 play');
    // The Session switched into has its own Window, laid out for whoever
    // attached to it last — so the size goes out again though it has not
    // changed.
    expect(kit.hosts[0].verbs()).toContain('refresh-client');
  });

  it('moves a tapped Pane before the Host is asked, and puts it back if refused', async () => {
    const split = fakeHost();
    const LAYOUT = 'b25d,49x41,0,0[49x20,0,0,0,49x20,0,21,2]';
    split.answering('list-panes', [
      `0\t%0\tzsh\t1\t/home/user\t${LAYOUT}`,
      `1\t%2\tzsh\t0\t/home/user\t${LAYOUT}`,
    ]);
    const kit = attachOn({ hosts: [split] });
    await connected(kit);
    expect(kit.attach.state().topology.activePane?.id).toBe('%0');

    split.refuseCommand('select-pane');
    kit.attach.selectPane('%2');

    // Moved here first, before the Host has answered: the cursor, the keyboard
    // and the Panes sheet all follow the Topology.
    expect(kit.attach.state().topology.activePane?.id).toBe('%2');

    await settle();

    // Then refused, which is a quiet line and a Topology read that undoes the
    // guess rather than a Pane left highlighted that the Host denied.
    expect(kit.attach.state().trouble).toContain('select Pane');
    expect(kit.attach.state().topology.activePane?.id).toBe('%0');
    expect(kit.attach.state().phase.kind).toBe('connected');
  });

  it('picks a Pane in one command, and asks tmux to carry the Zoom across', async () => {
    const split = fakeHost();
    const LAYOUT = 'b25d,49x41,0,0[49x20,0,0,0,49x20,0,21,2]';
    split.answering('list-panes', [
      `0\t%0\tzsh\t1\t/home/user\t${LAYOUT}`,
      `1\t%2\tzsh\t0\t/home/user\t${LAYOUT}`,
    ]);
    const kit = attachOn({ hosts: [split] });
    await connected(kit);
    split.commands.length = 0;

    kit.attach.selectPane('%2');
    await settle();

    // One command, and nothing after it. A plain `select-pane` unzooms a
    // zoomed Window, and putting the zoom back is a `list-windows`, a
    // `resize-pane` and a re-read — three round trips through which the phone
    // draws the split it is about to throw away, which reads as a flick from
    // one layout to the other on every tap. `-Z` has tmux keep the zoom
    // instead, and the Topology arrives in the notifications tmux sends of its
    // own accord.
    expect(split.verbs()).toEqual(['select-pane']);
    expect(split.commands[0]).toContain("'-Z'");
    expect(kit.attach.state().zoomed).toBe(true);
  });

  it('turns a command nobody waited on into a quiet line, not a dead screen', async () => {
    const kit = attachOn();
    await connected(kit);
    kit.hosts[0].refuseCommand('list-windows');

    kit.attach.setZoom(false);
    await settle();

    expect(kit.attach.state().zoomed).toBe(false);
    expect(kit.attach.state().trouble).not.toBeNull();
    expect(kit.attach.state().phase.kind).toBe('connected');
  });
});

describe('a Session that is let go', () => {
  it('tells no subscriber and writes no command, however much was in flight', async () => {
    const kit = attachOn();
    await connected(kit);

    // Everything at once, and then the Attach closed under all of it.
    void kit.attach.split('down');
    kit.attach.setZoom(false);
    kit.attach.refreshSessions();
    kit.attach.refreshTopology();
    await kit.attach.close();

    const afterClose = kit.seen.length;
    const written = kit.hosts[0].commands.length;

    kit.attach.windowGridReported({ cols: 40, rows: 20 }, PHONE);
    kit.attach.sheetPresented(false);
    kit.attach.selectPane('%0');
    kit.attach.refreshSessions();
    kit.clock.advance(10_000);
    await settle();

    expect(kit.seen).toHaveLength(afterClose);
    expect(kit.hosts[0].commands).toHaveLength(written);
    expect(kit.hosts[0].channelOpen).toBe(false);
    expect(kit.attach.state().phase.kind).toBe('closed');
  });

  it('never reconnects on its own', async () => {
    const kit = attachOn();
    await connected(kit);

    await kit.attach.close();
    kit.attach.lifecycleChanged('background');
    kit.attach.lifecycleChanged('active');
    await settle();

    expect(kit.opened).toHaveLength(1);
  });
});

describe('saying why a Connection ended', () => {
  it('reads tmux letting go as the Session ending, with no reconnect', async () => {
    const kit = attachOn();
    await connected(kit);

    kit.hosts[0].exit('server exited unexpectedly');
    await settle();

    const phase = kit.attach.state().phase;
    if (phase.kind !== 'disconnected') throw new Error('expected disconnected');
    expect(phase.reason.kind).toBe('session-ended');
    expect(kit.opened).toHaveLength(1);
  });

  it('reads the channel disappearing as the transport, and tries once', async () => {
    const kit = attachOn({ hosts: [fakeHost(), fakeHost()] });
    await connected(kit);

    kit.hosts[0].drop();
    await settle();

    expect(kit.attach.state().phase.kind).toBe('reconnecting');
    expect(kit.phases()).toContain('disconnected');

    await connected(kit, 1);
    expect(kit.attach.state().phase.kind).toBe('connected');
    expect(kit.opened).toHaveLength(2);
  });
});

describe('reconnecting by hand', () => {
  it('closes everything old before opening anything new, and ends connected', async () => {
    const kit = attachOn({ hosts: [fakeHost(), fakeHost()] });
    await connected(kit);

    kit.hosts[0].exit('server exited unexpectedly');
    await settle();
    expect(kit.attach.state().phase.kind).toBe('disconnected');

    kit.attach.reconnect();
    await settle();
    // The first Host's channel is shut before the second is opened.
    expect(kit.hosts[0].channelOpen).toBe(false);
    expect(kit.attach.state().phase.kind).toBe('reconnecting');

    kit.hosts[1].accept();
    await settle();
    expect(kit.attach.state().phase.kind).toBe('connected');
  });

  it('is sized from the last stable grid, with Zoom re-applied', async () => {
    const kit = attachOn({ hosts: [fakeHost(), fakeHost()] });
    await connected(kit);

    // The keyboard starts to rise as the link dies: nothing settled at the
    // new shape, so the shape carried into the reconnect is the old one.
    kit.attach.windowGridReported({ cols: 49, rows: 21 }, PHONE);
    kit.clock.advance(6);
    kit.hosts[0].drop();
    await settle();
    kit.hosts[1].accept();
    await settle();

    expect(kit.hosts[1].commands[0]).toContain("'-C' '49x41'");
    expect(kit.hosts[1].verbs()).toContain('list-windows');
  });

  it('lets nothing from the Connection it replaced reach a subscriber', async () => {
    const kit = attachOn({ hosts: [fakeHost(), fakeHost()] });
    await connected(kit);

    kit.hosts[0].drop();
    await settle();
    const afterReplacement = kit.seen.length;

    // The dead Connection still has things to say. None of them count.
    kit.hosts[0].notify('%window-renamed @0 ghost');
    kit.hosts[0].exit('and again');
    await settle();

    expect(kit.seen).toHaveLength(afterReplacement);
  });
});

describe('the app going away and coming back', () => {
  it('changes nothing on the wire while it is in the background', async () => {
    const kit = attachOn();
    await connected(kit);
    kit.hosts[0].commands.length = 0;

    kit.attach.lifecycleChanged('background');
    kit.attach.refreshSessions();
    kit.attach.capturePreviews(['work:0']);
    kit.attach.refreshTopology();
    kit.clock.advance(60_000);
    await settle();

    expect(kit.hosts[0].commands).toEqual([]);
  });

  it('writes nothing to a Surface while it is in the background', async () => {
    const kit = attachOn();
    await connected(kit);
    const surface = fakeSurface();
    kit.attach.surfaceForPane('%0', surface);
    kit.attach.paneGridReported('%0', GRID);
    kit.clock.advance(1000);
    await settle();
    surface.written.length = 0;

    kit.attach.lifecycleChanged('background');
    kit.hosts[0].notify('%output %0 hello');
    kit.clock.advance(1000);
    await settle();

    expect(surface.written).toEqual([]);
  });

  it('carries on when the link survived, without reconnecting', async () => {
    const kit = attachOn();
    await connected(kit);

    kit.attach.lifecycleChanged('background');
    kit.attach.lifecycleChanged('active');
    await settle();

    expect(kit.attach.state().phase.kind).toBe('connected');
    expect(kit.opened).toHaveLength(1);
  });

  it('restores once when the link did not survive', async () => {
    const kit = attachOn({ hosts: [fakeHost(), fakeHost()] });
    await connected(kit);

    kit.attach.lifecycleChanged('background');
    // iOS suspended the app; the socket went and nobody was there to hear it.
    kit.hosts[0].dieQuietly();
    kit.attach.lifecycleChanged('active');
    await settle();

    expect(kit.phases()).toContain('restoring');
    kit.hosts[1].accept();
    await settle();
    expect(kit.attach.state().phase.kind).toBe('connected');
  });

  it('does not try a second time from the same source before it has connected', async () => {
    const kit = attachOn({ hosts: [fakeHost(), fakeHost(), fakeHost()] });
    await connected(kit);

    kit.attach.lifecycleChanged('background');
    kit.hosts[0].dieQuietly();
    kit.attach.lifecycleChanged('active');
    await settle();
    // The restore never completes: the second Host refuses the attach.
    kit.hosts[1].refuse('no sessions');
    await settle();
    expect(kit.attach.state().phase.kind).toBe('disconnected');

    // Away and back again. The foreground source has had its one attempt.
    kit.attach.lifecycleChanged('background');
    kit.attach.lifecycleChanged('active');
    await settle();

    expect(kit.attach.state().phase.kind).toBe('disconnected');
    expect(kit.opened).toHaveLength(2);
  });

  it('forgets the attempts it has made once it is connected again', async () => {
    const kit = attachOn({ hosts: [fakeHost(), fakeHost(), fakeHost()] });
    await connected(kit);

    kit.hosts[0].drop();
    await settle();
    await connected(kit, 1);
    expect(kit.attach.state().phase.kind).toBe('connected');

    // A second loss, which a record that never cleared would refuse to retry.
    kit.hosts[1].drop();
    await settle();

    expect(kit.attach.state().phase.kind).toBe('reconnecting');
    expect(kit.opened).toHaveLength(3);
  });

  it('never reconnects for a reason other than a lost transport', async () => {
    const kit = attachOn({ hosts: [fakeHost(), fakeHost()] });
    await connected(kit);

    kit.hosts[0].exit('server exited unexpectedly');
    await settle();
    kit.attach.lifecycleChanged('background');
    kit.attach.lifecycleChanged('active');
    await settle();

    expect(kit.attach.state().phase.kind).toBe('disconnected');
    expect(kit.opened).toHaveLength(1);
  });
});

describe('the Panes on screen', () => {
  it('routes output to the Pane it belongs to and nowhere else', async () => {
    const kit = attachOn();
    await connected(kit);
    const mine = fakeSurface();
    kit.attach.surfaceForPane('%0', mine);
    kit.attach.paneGridReported('%0', GRID);
    kit.clock.advance(1000);
    await settle();
    mine.written.length = 0;

    kit.hosts[0].notify('%output %0 here');
    kit.hosts[0].notify('%output %9 elsewhere');
    await settle();

    const text = mine.written.map((each) => new TextDecoder().decode(each)).join('');
    expect(text).toContain('here');
    expect(text).not.toContain('elsewhere');
  });

  it('re-creates a Pane view over the Surface it kept, after a replacement', async () => {
    // A reconnect is a replacement, so every view is let go with the Client it
    // was made against. The Surfaces belong to the screen and did not go
    // anywhere — so the Panes have to come back over them without the screen
    // re-mounting anything, or a reconnect leaves a live Connection painting
    // nothing.
    const kit = attachOn({ hosts: [fakeHost(), fakeHost()] });
    await connected(kit);
    const screen = fakeSurface();
    kit.attach.surfaceForPane('%0', screen);
    kit.attach.paneGridReported('%0', GRID);
    kit.clock.advance(1000);
    await settle();

    kit.hosts[0].drop();
    await settle();
    screen.written.length = 0;
    await connected(kit, 1);
    await settle();

    expect(screen.written.length).toBeGreaterThan(0);
    kit.hosts[1].notify('%output %0 alive again');
    await settle();
    const text = screen.written.map((each) => new TextDecoder().decode(each)).join('');
    expect(text).toContain('alive again');
  });

  it('takes a Surface together with the grid it reported before this Attach existed', async () => {
    // A Surface says its grid once per size. An Attach introduced to one that
    // has been on screen a while — the one this screen belonged to was
    // replaced underneath it — would otherwise wait for a report that went to
    // its predecessor, and paint nothing.
    const kit = attachOn();
    await connected(kit);
    const surface = fakeSurface();

    kit.attach.surfaceForPane('%0', surface, GRID);
    await settle();

    expect(surface.written.length).toBeGreaterThan(0);
  });

  it('keeps a Surface whose Pane leaves the Topology and comes back', async () => {
    // React folds two Topologies published in one turn into one render, so a
    // Pane that left and returned between them keeps the Surface it had. The
    // Attach used to forget that Surface with the Pane, leaving a mounted
    // Surface no view would ever paint or raise a keyboard on.
    const kit = attachOn();
    await connected(kit);
    const surface = fakeSurface();
    kit.attach.surfaceForPane('%0', surface, GRID);
    await settle();

    kit.hosts[0].answering('list-panes', ['0\t%7\tzsh\t1\t/home/user\tb25d,49x41,0,0,7']);
    kit.hosts[0].notify('%window-add @1');
    await settle();
    expect(kit.attach.state().topology.panes.map((pane) => pane.id)).toEqual(['%7']);

    kit.hosts[0].answering('list-panes', ['0\t%0\tzsh\t1\t/home/user\tb25d,49x41,0,0,0']);
    kit.hosts[0].notify('%window-add @2');
    await settle();
    expect(kit.attach.state().topology.panes.map((pane) => pane.id)).toEqual(['%0']);
    surface.written.length = 0;

    kit.hosts[0].notify('%output %0 back again');
    await settle();
    const text = surface.written.map((each) => new TextDecoder().decode(each)).join('');
    expect(text).toContain('back again');
    await kit.attach.view('%0').toggleKeyboard();
    expect(await surface.isFocused()).toBe(true);
  });

  it('resyncs a Pane that is given a Surface again', async () => {
    const kit = attachOn();
    await connected(kit);
    kit.attach.surfaceForPane('%0', fakeSurface());
    kit.attach.paneGridReported('%0', GRID);
    kit.clock.advance(1000);
    await settle();

    // Home, and back: the screen unmounts and mounts a new Surface while the
    // Attach stays up.
    kit.attach.surfaceForPane('%0', null);
    const second = fakeSurface();
    kit.attach.surfaceForPane('%0', second);
    kit.attach.paneGridReported('%0', GRID);
    kit.clock.advance(1000);
    await settle();

    expect(second.written.length).toBeGreaterThan(0);
  });
});
