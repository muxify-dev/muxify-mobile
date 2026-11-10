import { lastTopic, type TopicDetail, type TopicRead } from '@/topics/topic-detail';
import type { TopicId } from '@/topics/environment';
import { createLog } from '@/diagnostics/log';
import { createTestClock, type TestClock } from '@/lib/test-clock';
import { MissingCredentialError } from '@/ssh/failures';
import type { Host } from '@/storage/records';
import type { HostStore } from '@/storage/store';

import type { AttachmentFile, Upload } from '@/composer/types';

import {
  CLEAR_SETTLE_MS,
  openAttach,
  type Attach,
  type AttachState,
  type HostConnection,
} from './attach';
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
  const answers = new Map<string, string[] | ((command: string) => string[])>([
    [
      'list-windows',
      ['@0\t0\t1\t2\t0\tshell\tzsh'],
    ],
    ['list-panes', ['0\t%0\tzsh\t1\t/home/user\tb25d,49x41,0,0,0']],
    ['list-sessions', ['work\t1']],
    ['display-message', ['0\t0\t0\t100\t49\t41\t0\t1\t1']],
  ]);
  /** Commands the Host refuses, by their first word. */
  const refusing = new Set<string>();
  const held = new Set<string>();
  const queued: string[] = [];

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
    if (held.has(verbOf(line)) || queued.length > 0) { queued.push(line); return; }
    replies += 1;
    const verb = verbOf(line);
    if (refusing.has(verb)) {
      say(`%begin 1 ${replies} 1\nthe Host refused ${verb}\n%error 1 ${replies} 1\n`);
      return;
    }
    const answer = answers.get(verb) ?? [];
    const lines = typeof answer === 'function' ? answer(line) : answer;
    say(`%begin 1 ${replies} 1\n${lines.map((each) => `${each}\n`).join('')}%end 1 ${replies} 1\n`);
  }

  return {
    transport,
    commands,
    hold: (verb: string) => held.add(verb),
    release: (verb?: string) => {
      if (verb) held.delete(verb);
      else held.clear();
      queued.splice(0).forEach(answer);
    },
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
    answering: (verb: string, lines: string[] | ((command: string) => string[])) => answers.set(verb, lines),
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
      Promise.resolve({
        hosts: [HOST],
        identities: [],
        fingerprints: [],
        recentSessions: [],
        lastPlace: null,
      }),
    saveHost: () => Promise.reject(new Error('not used here')),
    removeHost: () => Promise.resolve(),
    reorderHosts: () => Promise.resolve(),
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
    rememberLastPlace: ({ hostId, session, topicId }) => {
      wrote.push(`last place ${hostId} ${session} ${topicId ?? 'no Topic'}`);
      return Promise.resolve();
    },
    forgetLastPlace: () => Promise.resolve(),
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
    topicId?: string;
    readTopic?: (hostId: string, topicId: TopicId) => Promise<TopicRead>;
    zoomed?: boolean;
    upload?: Upload;
  } = {},
) {
  const hosts = options.hosts ?? [fakeHost()];
  const { store, wrote } = fakeStore();
  const clock = createTestClock();
  const seen: AttachState[] = [];
  const opened: ReturnType<typeof fakeHost>[] = [];
  /** How the Attach let each Connection go: given back, or discarded. */
  const letGo: ('close' | 'discard')[] = [];
  /** What the Attach asked to run when a screen finds its Connection slow. */
  const suspects: (() => void)[] = [];
  const log = createLog({ clock });

  let next = 0;
  const attach = openAttach({
    host: HOST,
    destination: { sessionName: options.sessionName ?? 'work', topic: options.topicId ? { id: options.topicId as TopicId, seed: null } : null },
    zoomed: options.zoomed ?? true,
    readTopic: options.readTopic,
    store,
    clock,
    log,
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
        upload: options.upload,
        close: () => {
          letGo.push('close');
          return Promise.resolve();
        },
        discard: () => {
          letGo.push('discard');
          return Promise.resolve();
        },
        suspected: (check) => {
          suspects.push(check);
          return () => {};
        },
      });
    },
  });

  attach.subscribe((state) => seen.push(state));

  return {
    attach,
    hosts,
    opened,
    letGo,
    suspects,
    store,
    wrote,
    clock,
    seen,
    phases: () => seen.map((state) => state.phase.kind),
    /** What was written to the Log, as `tag: text`. */
    said: () => log.entries().map((entry) => `${entry.tag}: ${entry.text}`),
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
    showSelection: () => {},
    endSelection: () => {},
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
      // Window was not zoomed — then the Topology, then the Session list. The
      // size goes with a claim on the Window, so a laptop that typed last does
      // not keep it.
      'select-window',
      'refresh-client',
      'list-windows',
      'resize-pane',
      'list-windows',
      'list-panes',
      'list-sessions',
    ]);
    // The pre-layout grid never reached tmux.
    expect(kit.hosts[0].commands[1]).toContain("'-C' '49x41'");
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

  it('records the Last Place, with its Topic, once the Session actually opened', async () => {
    const kit = attachOn({ topicId: 'topic-7' });
    await settle();
    expect(kit.wrote.filter((line) => line.startsWith('last place'))).toEqual([]);
    await connected(kit);
    await settle();
    expect(kit.wrote).toContain('last place host-1 work topic-7');
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

    await kit.attach.switchSession({ sessionName: 'play', topic: null });
    await settle();

    expect(kit.attach.state().sessionName).toBe('play');
    expect(kit.wrote).toContain('session host-1 play');
    expect(kit.wrote).toContain('last place host-1 play no Topic');
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
    expect(kit.attach.selectPane('%2')).toBe(true);
    expect(kit.attach.selectPane('%2')).toBe(false);

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

  it('reads the mouse and alternate screen for the active Pane', async () => {
    const split = fakeHost();
    const LAYOUT = 'b25d,49x41,0,0[49x20,0,0,0,49x20,0,21,2]';
    split.answering('list-panes', [
      `0\t%0\tclaude\t1\t/home/user\t${LAYOUT}`,
      `1\t%2\tzsh\t0\t/home/user\t${LAYOUT}`,
    ]);
    const kit = attachOn({ hosts: [split] });
    await connected(kit);
    // The program in %0 listens for the mouse, and the one in %2 does not.
    split.answering('display-message', ['0\t0\t1\t0\t49\t20\t1\t1\t1']);
    kit.attach.surfaceForPane('%0', fakeSurface(), { cols: 49, rows: 20 });
    await settle();
    split.answering('display-message', ['0\t0\t0\t100\t49\t20\t0\t1\t1']);
    kit.attach.surfaceForPane('%2', fakeSurface(), { cols: 49, rows: 20 });
    await settle();
    expect(kit.attach.state().mouseTracking).toBe(true);
    expect(kit.attach.state().alternate).toBe(true);

    kit.attach.selectPane('%2');
    expect(kit.attach.state().mouseTracking).toBe(false);
    expect(kit.attach.state().alternate).toBe(false);

    kit.attach.selectPane('%0');
    expect(kit.attach.state().mouseTracking).toBe(true);
    expect(kit.attach.state().alternate).toBe(true);
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

describe('the Key Row’s Shortcuts', () => {
  /** The answer to a question that a paste of one line never asks. */
  const never = () => Promise.reject(new Error('asked to run lines'));

  const stagedImage: AttachmentFile = {
    uri: 'file:///cache/composer/1/pasted-image.png',
    name: 'pasted-image.png',
    size: 3,
    image: true,
    open: () => ({ readBytes: () => new Uint8Array(), close: () => {} }),
    dispose: () => {},
  };

  it('pastes text into the active Pane and presses nothing after it', async () => {
    const kit = attachOn();
    await connected(kit);
    kit.hosts[0].commands.length = 0;

    await kit.attach.paste({ kind: 'text', text: 'rm -rf build' }, never);

    const sent = kit.hosts[0].commands.join('\n');
    expect(sent).toContain("'set-buffer'");
    expect(sent).toContain("'rm -rf build'");
    expect(sent).toMatch(/'paste-buffer'.*'-t' '%0'/);
    // A paste is not a send: no Enter, and no other key either.
    expect(kit.hosts[0].verbs()).not.toContain('send-keys');
  });

  it('uploads a pasted image and pastes its path, quoted for a shell', async () => {
    const uploaded: AttachmentFile[] = [];
    const kit = attachOn({
      upload: (file) => {
        uploaded.push(file);
        return Promise.resolve("/tmp/muxify/it's a shot.png");
      },
    });
    await connected(kit);
    kit.hosts[0].commands.length = 0;

    await kit.attach.paste({ kind: 'image', file: stagedImage }, never);

    expect(uploaded).toEqual([stagedImage]);
    // The path as the Composer writes one into a message: single-quoted, with
    // its own quote closed, escaped and reopened. Inside tmux's double quotes
    // the backslash is doubled.
    const sent = kit.hosts[0].commands.join('\n');
    expect(sent).toContain(`"'/tmp/muxify/it'\\\\''s a shot.png'"`);
    expect(sent).toMatch(/'paste-buffer'.*'-t' '%0'/);
    expect(kit.hosts[0].verbs()).not.toContain('send-keys');
  });

  it('refuses an image on a Connection that cannot upload, and pastes nothing', async () => {
    const kit = attachOn();
    await connected(kit);
    kit.hosts[0].commands.length = 0;

    await expect(kit.attach.paste({ kind: 'image', file: stagedImage }, never)).rejects.toThrow(
      'This Connection cannot upload attachments.',
    );
    expect(kit.hosts[0].commands).toEqual([]);
  });

  it('refuses to paste once the Connection is gone', async () => {
    const kit = attachOn();
    await connected(kit);
    kit.hosts[0].exit('server exited');
    await settle();

    await expect(kit.attach.paste({ kind: 'text', text: 'late' }, never)).rejects.toThrow(
      'The Connection changed.',
    );
  });

  it('pastes two lines whole into a program that asked for bracketed paste', async () => {
    const kit = attachOn();
    await connected(kit);
    kit.hosts[0].commands.length = 0;

    await kit.attach.paste({ kind: 'text', text: 'make\nmake install' }, never);

    expect(kit.hosts[0].verbs()).toContain('paste-buffer');
  });

  it('asks before two lines go to a program that runs each line, and pastes nothing on a no', async () => {
    const kit = attachOn();
    await connected(kit);
    kit.hosts[0].answering('display-message', ['0\t0\t0\t100\t49\t41\t0\t1\t0']);
    kit.hosts[0].commands.length = 0;

    await kit.attach.paste({ kind: 'text', text: 'make\nmake install' }, () => Promise.resolve(false));
    expect(kit.hosts[0].verbs()).not.toContain('set-buffer');
    expect(kit.hosts[0].verbs()).not.toContain('paste-buffer');

    await kit.attach.paste({ kind: 'text', text: 'make\nmake install' }, () => Promise.resolve(true));
    expect(kit.hosts[0].verbs()).toContain('paste-buffer');
  });

  it('clears by letting the program redraw before it drops the Scrollback', async () => {
    const kit = attachOn();
    await connected(kit);
    kit.hosts[0].commands.length = 0;

    const cleared = kit.attach.clearPane();
    await settle();
    // Measured on tmux: a shell answers C-l by clearing its screen, and that
    // screen lands in the Scrollback if the Scrollback was dropped first.
    expect(kit.hosts[0].commands).toEqual(["'send-keys' '-t' '%0' 'C-l'"]);

    kit.clock.advance(CLEAR_SETTLE_MS);
    await cleared;
    expect(kit.hosts[0].commands.slice(1)).toEqual(["'clear-history' '-t' '%0'"]);
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

describe('the Connection it shares with the screens', () => {
  it('discards a Connection it lost, so the next one is new', async () => {
    const kit = attachOn({ hosts: [fakeHost(), fakeHost()] });
    await connected(kit);

    kit.hosts[0].drop();
    await settle();

    // More than once is fine: the registry's release ignores a second call.
    expect(kit.letGo.length).toBeGreaterThan(0);
    expect(kit.letGo.every((how) => how === 'discard')).toBe(true);
  });

  it('gives a Connection back when it is closed on purpose', async () => {
    const kit = attachOn();
    await connected(kit);

    await kit.attach.close();

    expect(kit.letGo).toEqual(['close']);
  });

  it('carries on when a screen finds the Connection slow and the link is open', async () => {
    const kit = attachOn();
    await connected(kit);

    kit.suspects[0]?.();
    await settle();

    expect(kit.attach.state().phase.kind).toBe('connected');
    expect(kit.said()).toContain('attach: a screen found the Connection slow; the link is still open');
  });

  it('reconnects when a screen finds the Connection slow and the link is gone', async () => {
    const kit = attachOn({ hosts: [fakeHost(), fakeHost()] });
    await connected(kit);

    kit.hosts[0].dieQuietly();
    kit.suspects[0]?.();
    await settle();

    expect(kit.phases()).toContain('disconnected');
    expect(kit.attach.state().phase.kind).toBe('reconnecting');
    expect(kit.letGo.every((how) => how === 'discard')).toBe(true);
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

  it('reads the normal screen after reconnecting to the same Pane id', async () => {
    const before = fakeHost();
    before.answering('display-message', ['0\t0\t1\t0\t49\t41\t0\t1\t1']);
    const kit = attachOn({ hosts: [before, fakeHost()] });
    await connected(kit);
    kit.attach.surfaceForPane('%0', fakeSurface(), GRID);
    await settle();
    expect(kit.attach.state().alternate).toBe(true);

    before.drop();
    await settle();
    await connected(kit, 1);
    expect(kit.attach.state().topology.activePane?.id).toBe('%0');
    expect(kit.attach.state().alternate).toBe(false);
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

    expect(kit.hosts[1].commands[1]).toContain("'-C' '49x41'");
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

  it('writes down how a Pane came to be painted, so a blank one can be read back', async () => {
    // The Log is the account a person carries away from a Pane that came up
    // blank. What it has to hold is the chain a paint depends on — the Attach
    // connecting, the Topology arriving, the Surface arriving and reporting,
    // the paint — each from the module that decided it, so that the link
    // which is missing can be seen missing.
    const kit = attachOn();
    await connected(kit);
    kit.attach.surfaceForPane('%0', fakeSurface());
    kit.attach.paneGridReported('%0', GRID);
    kit.clock.advance(1000);
    await settle();

    const said = kit.said();
    expect(said).toContain('attach: connecting to Dev Host (10.0.0.2:22) for work');
    expect(said).toContain('attach: phase connected');
    expect(said).toContain('control: → list-windows -t work -F #{window_id}\t#{window_index}\t#{window_active}\t#{window_panes}\t#{window_zoomed_flag}\t#{window_name}\t#{pane_current_command}');
    expect(said).toContain('topology: 1 window, active @0 #0; 1 pane: %0* 0,0 49x41');
    expect(said).toContain('attach: Surface for %0 arrived, not yet reported; no view for it yet');
    expect(said).toContain('pane %0: Surface arrived');
    expect(said).toContain('pane %0: not painting yet: no grid');
    expect(said).toContain('pane %0: grid 49x41 reported');
    expect(said).toContain('pane %0: repainting at 49x41');
    expect(said).toContain('pane %0: painted 0 lines at 41 rows, cursor 0,0');
  });

  it('never writes what was typed into the Log, only how much', async () => {
    const kit = attachOn();
    await connected(kit);
    kit.attach.surfaceForPane('%0', fakeSurface());
    kit.attach.paneGridReported('%0', GRID);
    kit.clock.advance(1000);
    await settle();

    kit.attach.view('%0').type(new TextEncoder().encode('hunter2'));
    await settle();

    const said = kit.said().join('\n');
    expect(said).toContain('control: → send-keys -t %0 -H (7 bytes)');
    expect(said).not.toContain('hunter2');
    expect(said).not.toContain('68756e');
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

describe('another Client resizing the Window', () => {
  /** The laptop typed last, so tmux gave the Window its 115x72. */
  const LAPTOP_TOOK_IT = '%layout-change @0 b25d,115x72,0,0,0 b25d,115x72,0,0,0 *';

  async function painted() {
    const kit = attachOn();
    await connected(kit);
    const surface = fakeSurface();
    kit.attach.surfaceForPane('%0', surface);
    kit.attach.paneGridReported('%0', GRID);
    kit.clock.advance(1000);
    await settle();
    return { kit, surface, since: kit.hosts[0].commands.length };
  }

  it('repaints every Pane when the Window changes size', async () => {
    const { kit, since } = await painted();

    kit.hosts[0].notify(LAPTOP_TOOK_IT);
    await settle();

    expect(kit.hosts[0].verbs().slice(since)).toContain('capture-pane');
  });

  it('takes the Window back when the phone is typed on', async () => {
    const { kit } = await painted();
    kit.hosts[0].notify(LAPTOP_TOOK_IT);
    await settle();
    const before = kit.hosts[0].commands.length;

    kit.attach.view('%0').type(new TextEncoder().encode('a'));
    await settle();

    const after = kit.hosts[0].commands.slice(before).join('\n');
    expect(after).toContain("'select-window'");
    expect(after).toContain("'refresh-client' '-C' '49x41'");
  });

  it('leaves the Window alone when it is already the phone’s size', async () => {
    const { kit, since } = await painted();

    kit.attach.view('%0').type(new TextEncoder().encode('a'));
    await settle();

    expect(kit.hosts[0].verbs().slice(since)).not.toContain('select-window');
  });
});


describe('the current Topic belongs to the Attach', () => {
  const topic = (id: string): TopicDetail => ({ id: id as TopicId, label: id, note: null,
    tags: [], state: 'live', sessions: [] });
  const destination = (sessionName: string, id: string) => ({ sessionName, topic: { id: id as TopicId, seed: topic(id) } });

  it('keeps a sibling switch in Last Place and clears it for a plain same-Session pick', async () => {
    const kit = attachOn({ topicId: 'a' });
    await connected(kit);
    await kit.attach.switchSession(destination('play', 'a'));
    await settle();
    expect(kit.attach.state().topic?.id).toBe('a');
    expect(kit.wrote).toContain('last place host-1 play a');
    kit.hosts[0].commands.length = 0;
    await kit.attach.switchSession({ sessionName: 'play', topic: null });
    await settle();
    expect(kit.attach.state().topic).toBeNull();
    expect(kit.wrote.at(-1)).toBe('last place host-1 play no Topic');
    expect(kit.hosts[0].verbs()).not.toContain('switch-client');
  });

  it('rejects an old Topic read after a switch and a pre-edit read after a fresh read', async () => {
    const reads: ((value: TopicRead) => void)[] = [];
    const kit = attachOn({ topicId: 'a', readTopic: () => new Promise((resolve) => reads.push(resolve)) });
    await connected(kit);
    await kit.attach.switchSession(destination('work', 'b'));
    const fresh = kit.attach.refreshTopic();
    reads.at(-1)!({ kind: 'shown', topic: { ...topic('b'), label: 'Saved title' } });
    await fresh;
    reads[0]({ kind: 'shown', topic: topic('a') });
    reads[1]({ kind: 'shown', topic: { ...topic('b'), label: 'Old title' } });
    await settle();
    expect(kit.attach.state().topic?.id).toBe('b');
    expect(lastTopic(kit.attach.state().topic!.view)?.label).toBe('Saved title');
  });

  it('refuses a superseded switch while keeping a later unsolicited Session', async () => {
    const kit = attachOn();
    await connected(kit);
    const host = kit.hosts[0];
    host.hold('switch-client');
    const change = kit.attach.switchSession(destination('play', 'b'));
    await expect(kit.attach.switchSession(destination('other', 'c'))).rejects.toThrow('already in progress');
    host.notify('%session-changed $2 play');
    expect(kit.attach.state().topic?.id).toBe('b');
    host.notify('%session-changed $3 elsewhere');
    host.release();
    await expect(change).rejects.toThrow('Host changed Session');
    await settle();
    expect(kit.attach.state().sessionName).toBe('elsewhere');
    expect(kit.attach.state().topic).toBeNull();
    expect(kit.wrote.filter((line) => line === 'last place host-1 play b')).toHaveLength(1);
    expect(kit.wrote.at(-1)).toBe('last place host-1 elsewhere no Topic');
  });

  it('keeps the latest Session but refuses a switch superseded before returning to that Session', async () => {
    const kit = attachOn();
    await connected(kit);
    const host = kit.hosts[0];
    host.hold('switch-client');
    const change = kit.attach.switchSession(destination('play', 'b'));
    host.notify('%session-changed $2 play');
    host.notify('%session-changed $3 elsewhere');
    host.notify('%session-changed $2 play');
    expect(kit.attach.state().sessionName).toBe('play');
    host.release();
    await expect(change).rejects.toThrow('Host changed Session');
    expect(kit.attach.state().topic).toBeNull();
  });

  it('does not overwrite a newer notification when the requested notification is absent', async () => {
    const kit = attachOn();
    await connected(kit);
    const host = kit.hosts[0];
    host.hold('switch-client');
    const change = kit.attach.switchSession(destination('play', 'b'));
    host.notify('%session-changed $3 elsewhere');
    host.release();
    await expect(change).rejects.toThrow('Host changed Session');
    expect(kit.attach.state().sessionName).toBe('elsewhere');
  });

  it('refuses a dependent Window action after the Session changes during Topology refresh', async () => {
    const kit = attachOn();
    await connected(kit);
    const host = kit.hosts[0];
    host.hold('list-windows');
    const pickWindow = kit.attach.switchSession(destination('play', 'b')).then(() => kit.attach.selectWindow(7));
    await settle();
    expect(kit.attach.state().sessionName).toBe('play');
    host.notify('%session-changed $3 elsewhere');
    host.release();
    await expect(pickWindow).rejects.toThrow('Host changed Session');
    expect(kit.attach.state().sessionName).toBe('elsewhere');
    expect(host.commands.some((command) => command.includes("'select-window'") && command.includes(':7'))).toBe(false);
  });

  it('refuses a dependent Window action when close ends the Attach during Topology refresh', async () => {
    const kit = attachOn();
    await connected(kit);
    const host = kit.hosts[0];
    host.hold('list-windows');
    const pickWindow = kit.attach.switchSession(destination('play', 'b')).then(() => kit.attach.selectWindow(7));
    const refused = expect(pickWindow).rejects.toThrow('Attach changed');
    await settle();
    expect(kit.attach.state().sessionName).toBe('play');
    await kit.attach.close();
    host.release();
    await refused;
    expect(kit.attach.state().phase.kind).toBe('closed');
    expect(kit.attach.state().trouble).toBeNull();
    expect(host.commands.some((command) => command.includes("'select-window'") && command.includes(':7'))).toBe(false);
  });

  it('keeps a confirmed destination if the following Topology read fails', async () => {
    const kit = attachOn();
    await connected(kit);
    kit.hosts[0].refuseCommand('list-windows');
    await kit.attach.switchSession(destination('play', 'b'));
    expect(kit.attach.state().sessionName).toBe('play');
    expect(kit.attach.state().topic?.id).toBe('b');
    expect(kit.attach.state().trouble).not.toBeNull();
  });

  it('reconnects and persists the latest destination', async () => {
    const kit = attachOn({ hosts: [fakeHost(), fakeHost()] });
    await connected(kit);
    await kit.attach.switchSession(destination('play', 'b'));
    kit.hosts[0].drop();
    await connected(kit, 1);
    await settle();
    expect(kit.hosts[1].attachCommand).toContain('play');
    expect(kit.wrote.at(-1)).toBe('last place host-1 play b');
  });

  it('finishes queued arrival writes before close returns', async () => {
    const kit = attachOn();
    await connected(kit);
    let release!: () => void;
    kit.store.rememberSession = () => new Promise<void>((resolve) => { release = resolve; });
    await kit.attach.switchSession(destination('work', 'b'));
    await settle();
    let closed = false;
    const closing = kit.attach.close().then(() => { closed = true; });
    await settle();
    expect(closed).toBe(false);
    release();
    await closing;
    expect(kit.wrote.at(-1)).toBe('last place host-1 work b');
  });
});


describe('the current Session keeps its identity through a rename', () => {
  const topic = (label: string): TopicDetail => ({ id: 'a' as TopicId, label, note: null,
    tags: [], state: 'live', sessions: [] });
  const destination = { sessionName: 'play', topic: { id: 'b' as TopicId, seed: null } };

  async function observed(kit: ReturnType<typeof attachOn>) {
    await connected(kit);
    kit.hosts[0].notify('%session-changed $1 work');
    await settle();
  }

  it.each(['before', 'after'])('keeps its Topic and Pane when identity arrives %s opening resolves', async (timing) => {
    const kit = attachOn({ topicId: 'a', readTopic: async () => ({ kind: 'shown', topic: topic('Title') }) });
    const host = kit.hosts[0];
    if (timing === 'before') {
      kit.attach.containerLaidOut(PHONE);
      kit.attach.windowGridReported(GRID, PHONE);
      kit.clock.advance(GRID_SETTLE_MS * 2);
      await settle();
      host.accept();
      host.notify('%session-changed $1 work');
      host.notify('%session-renamed $1 Before');
      await settle();
    } else {
      await observed(kit);
    }
    const view = kit.attach.view('%0');
    host.notify('%session-renamed $1 Short');
    await settle();
    expect(kit.attach.state().sessionName).toBe('Short');
    expect(kit.attach.state().topic?.id).toBe('a');
    expect(lastTopic(kit.attach.state().topic!.view)?.label).toBe('Title');
    expect(kit.attach.state().topology.activePane).toMatchObject({ id: '%0', command: 'zsh' });
    expect(kit.attach.view('%0')).toBe(view);
    expect(kit.wrote.at(-1)).toBe('last place host-1 Short a');
    if (timing === 'before') expect(kit.wrote).not.toContain('last place host-1 work a');
    host.commands.length = 0;
    await kit.attach.selectWindow(7);
    await kit.attach.split('right');
    await kit.attach.newWindow();
    kit.attach.setZoom(false);
    await settle();
    const sessionCommands = host.commands.filter((line) =>
      ['list-windows', 'list-panes', 'select-window', 'split-window', 'new-window', 'resize-pane'].includes(verbOf(line)));
    expect(sessionCommands.length).toBeGreaterThan(4);
    expect(sessionCommands.every((line) => line.includes('$1'))).toBe(true);
    await kit.attach.close();
  });

  it('refreshes the Sessions list without moving on a sibling rename', async () => {
    const kit = attachOn({ topicId: 'a' });
    await observed(kit);
    const host = kit.hosts[0];
    const wrote = [...kit.wrote];
    host.answering('list-sessions', ['work\t1', 'Other\t1']);
    host.notify('%session-renamed $2 Other');
    await settle();
    expect(kit.attach.state().sessionName).toBe('work');
    expect(kit.attach.state().topic?.id).toBe('a');
    expect(kit.attach.state().sessions?.map((session) => session.name)).toEqual(['work', 'Other']);
    expect(kit.wrote).toEqual(wrote);
    await kit.attach.close();
  });

  it('keeps the program and ID target during a held Topology read and rename', async () => {
    const kit = attachOn({ topicId: 'a' });
    await observed(kit);
    const host = kit.hosts[0];
    const view = kit.attach.view('%0');
    host.commands.length = 0;
    host.hold('list-windows');
    kit.attach.refreshTopology();
    host.notify('%session-renamed $1 Short');
    host.release();
    await settle();
    expect(host.commands.filter((line) => ['list-windows', 'list-panes'].includes(verbOf(line)))
      .every((line) => line.includes('$1'))).toBe(true);
    expect(kit.attach.state().topology.activePane?.command).toBe('zsh');
    expect(kit.attach.view('%0')).toBe(view);
    await kit.attach.close();
  });

  it('keeps the active Pane when an initial name read finishes empty after identity and rename arrive', async () => {
    const kit = attachOn({ topicId: 'a' });
    await connected(kit);
    const host = kit.hosts[0];
    const view = kit.attach.view('%0');
    const since = kit.seen.length;
    host.hold('list-windows');
    kit.attach.refreshTopology();
    host.notify('%session-changed $1 work');
    host.notify('%session-renamed $1 Short');
    host.answering('list-windows', (line) => line.includes("'work'") ? [] : ['@0\t0\t1\t2\t0\tshell\tzsh']);
    host.release();
    await settle();
    expect(kit.attach.state().sessionName).toBe('Short');
    expect(kit.attach.state().topology.activePane?.id).toBe('%0');
    expect(kit.seen.slice(since).every((state) => state.topology.activePane?.id === '%0')).toBe(true);
    expect(kit.attach.view('%0')).toBe(view);
    await kit.attach.close();
  });

  it('targets Pane selection by the current Session ID after a rename', async () => {
    const kit = attachOn();
    await observed(kit);
    const host = kit.hosts[0];
    host.answering('list-panes', [
      '0\t%0\tzsh\t1\t/home/user\tb25d,49x41,0,0[49x20,0,0,0,49x20,0,21,2]',
      '1\t%2\tvim\t0\t/home/user\tb25d,49x41,0,0[49x20,0,0,0,49x20,0,21,2]',
    ]);
    kit.attach.refreshTopology();
    await settle();
    host.notify('%session-renamed $1 Short');
    expect(kit.attach.selectPane('%2')).toBe(true);
    await settle();
    expect(host.commands.find((line) => verbOf(line) === 'select-pane')).toContain('$1:0.1');
    expect(kit.attach.state().topology.activePane?.command).toBe('vim');
    await kit.attach.close();
  });

  it.each(['command reply', 'settlement'])('accepts a confirmed switch renamed during %s', async (when) => {
    const kit = attachOn({ topicId: 'a' });
    await observed(kit);
    const host = kit.hosts[0];
    host.hold('switch-client');
    if (when === 'settlement') host.hold('list-windows');
    const switching = kit.attach.switchSession(destination).then(() => kit.attach.selectWindow(7));
    host.notify('%session-changed $2 play');
    if (when === 'settlement') {
      host.release('switch-client');
      await settle();
    }
    host.notify('%session-renamed $2 Final');
    host.release();
    await expect(switching).resolves.toBeUndefined();
    await settle();
    expect(kit.attach.state().sessionName).toBe('Final');
    expect(kit.attach.state().topic?.id).toBe('b');
    expect(kit.wrote.at(-1)).toBe('last place host-1 Final b');
    expect(host.commands.some((line) => verbOf(line) === 'select-window' && line.includes('$2:7'))).toBe(true);
    await kit.attach.close();
  });

  it('does not confirm or redirect a pending switch from a rename before confirmation', async () => {
    const kit = attachOn({ topicId: 'a' });
    await observed(kit);
    const host = kit.hosts[0];
    host.hold('switch-client');
    const switching = kit.attach.switchSession(destination);
    host.notify('%session-renamed $2 Final');
    expect(kit.attach.state().sessionName).toBe('work');
    expect(kit.attach.state().topic?.id).toBe('a');
    host.notify('%session-changed $2 Final');
    host.release();
    await expect(switching).rejects.toThrow('Host changed Session');
    expect(kit.attach.state().topic).toBeNull();
    await kit.attach.close();
  });

  it('rejects a different Session ID even when its name matches the confirmed destination', async () => {
    const kit = attachOn();
    await observed(kit);
    const host = kit.hosts[0];
    host.hold('switch-client');
    const switching = kit.attach.switchSession(destination);
    host.notify('%session-changed $2 play');
    host.notify('%session-changed $3 play');
    host.release();
    await expect(switching).rejects.toThrow('Host changed Session');
    await kit.attach.close();
  });

  it('forgets the previous ID when a switch has no confirmation notification', async () => {
    const kit = attachOn();
    await observed(kit);
    const host = kit.hosts[0];
    await kit.attach.switchSession(destination);
    host.notify('%session-renamed $1 Old');
    await settle();
    expect(kit.attach.state().sessionName).toBe('play');
    expect(kit.wrote.at(-1)).toBe('last place host-1 play b');
    host.commands.length = 0;
    await kit.attach.selectWindow(7);
    expect(host.commands.find((line) => verbOf(line) === 'select-window')).toContain('play:7');
    await kit.attach.close();
  });

  it('reconnects by the observed name and accepts a fresh ID while ignoring the old Connection', async () => {
    const kit = attachOn({ topicId: 'a', hosts: [fakeHost(), fakeHost()] });
    await observed(kit);
    const [old, fresh] = kit.hosts;
    old.notify('%session-renamed $1 Short');
    await settle();
    kit.attach.lifecycleChanged('background');
    old.drop();
    const writes = [...kit.wrote];
    old.notify('%session-renamed $1 Disconnected');
    old.notify('%session-changed $9 Stale');
    await settle();
    expect(kit.attach.state().sessionName).toBe('Short');
    expect(kit.wrote).toEqual(writes);
    kit.attach.lifecycleChanged('active');
    await connected(kit, 1);
    expect(fresh.attachCommand).toContain('Short');
    expect(fresh.commands.filter((line) => verbOf(line) === 'list-windows').every((line) => line.includes("'Short'"))).toBe(true);
    fresh.notify('%session-renamed $1 Reused-by-sibling');
    expect(kit.attach.state().sessionName).toBe('Short');
    fresh.notify('%session-changed $7 Short');
    old.notify('%session-renamed $7 Old-connection');
    old.notify('%session-changed $8 Wrong');
    fresh.notify('%session-renamed $7 Final');
    await settle();
    expect(kit.attach.state().sessionName).toBe('Final');
    expect(kit.attach.state().topic?.id).toBe('a');
    expect(kit.wrote.at(-1)).toBe('last place host-1 Final a');
    await kit.attach.close();
  });

  it('rejects a pending switch on Connection loss before a delayed reply', async () => {
    const kit = attachOn({ hosts: [fakeHost(), fakeHost()] });
    await observed(kit);
    const host = kit.hosts[0];
    host.hold('switch-client');
    const switching = kit.attach.switchSession(destination);
    const refused = expect(switching).rejects.toThrow();
    host.notify('%session-changed $2 play');
    kit.attach.lifecycleChanged('background');
    host.drop();
    host.notify('%session-renamed $2 Stale');
    host.release();
    await refused;
    expect(kit.attach.state().sessionName).toBe('play');
    await kit.attach.close();
  });

  it('keeps rename writes ordered and rejects stale Topic reads', async () => {
    const reads: ((value: TopicRead) => void)[] = [];
    const kit = attachOn({ topicId: 'a', readTopic: () => new Promise((resolve) => reads.push(resolve)) });
    await observed(kit);
    let release!: () => void;
    const remember = kit.store.rememberSession;
    kit.store.rememberSession = jest.fn().mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }))
      .mockImplementation(remember);
    kit.hosts[0].notify('%session-renamed $1 Short');
    await settle();
    kit.hosts[0].notify('%session-renamed $1 Final');
    await settle();
    expect(kit.wrote.at(-1)).toBe('last place host-1 work a');
    reads.at(-1)!({ kind: 'shown', topic: topic('Fresh title') });
    reads[0]({ kind: 'shown', topic: topic('Old title') });
    reads[1]({ kind: 'shown', topic: topic('Intermediate title') });
    await settle();
    release();
    await kit.attach.close();
    expect(kit.wrote.filter((line) => line.startsWith('last place'))).toEqual([
      'last place host-1 work a', 'last place host-1 Short a', 'last place host-1 Final a',
    ]);
    expect(kit.attach.state().sessionName).toBe('Final');
    expect(lastTopic(kit.attach.state().topic!.view)?.label).toBe('Fresh title');
  });
});
