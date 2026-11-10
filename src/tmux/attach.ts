import { silentLog, speakingAs, type Log } from '@/diagnostics/log';
import { createComposer, type Composer } from '@/composer/composer';
import { checkAborted, uniqueId, type AttachmentFile, type Upload } from '@/composer/types';
import type { Clock } from '@/lib/clock';
import { describeError } from '@/lib/describe-error';
import { systemClock } from '@/lib/clock';
import type { KeyVerdict } from '@/ssh/host-key';
import type { Host } from '@/storage/records';
import type { HostStore } from '@/storage/store';

import { createClientSizing, type ClientSizing } from './client-sizing';
import { shellQuote } from './commands';
import {
  openControlConnection,
  type ClosedCause,
  type ControlConnection,
} from './control-connection';
import {
  retryCouldWork,
  reasonForAttachFailure,
  reasonForClosure,
  reasonForConnectFailure,
  type DisconnectReason,
  type ReconnectSource,
} from './disconnect-reason';
import {
  createPaneView,
  type PaneSurface,
  type PaneView,
  type ScrollPosition,
} from './pane-view';
import type { Extent } from './pane-layout';
import { createTopologyStore, EMPTY_TOPOLOGY, windowGrid, type Topology, type TopologyStore } from './topology';
import type { TmuxTransport } from './transport';
import { sameGrid, TmuxClient, type Grid, type Session } from './tmux-client';

/**
 * One live Connection to a Host, as Attach needs it.
 *
 * The transport seam, plus the one thing a Connection knows that a transport
 * does not: which key the Host presented. The SSH adapter is `sshConnection`;
 * the control-mode harness supplies a local process instead, and the unit
 * tests a fake.
 */
export interface HostConnection {
  transport: TmuxTransport;
  upload?: Upload;
  fingerprint: string;
  verdict: KeyVerdict;
  /** Gives the Connection back. Others on the same Host may still use it. */
  close(): Promise<void>;
  /** Closes the Connection for everyone, so the next one is new. Else as close. */
  discard?(): Promise<void>;
  /**
   * Runs `check` when something else on the Connection finds it slow. The
   * Attach decides what that means. Answers a function that stops it.
   */
  suspected?(check: () => void): () => void;
}

/** Opens one. Where the SSH library lives, and the one thing tests replace. */
export type OpenConnection = (host: Host) => Promise<HostConnection>;

/** What the app is doing, as React Native reports it. */
export type LifecyclePhase = 'active' | 'inactive' | 'background';

export type AttachPhase =
  | { kind: 'connecting' }
  | { kind: 'connected' }
  /** A reconnect the foreground check asked for. */
  | { kind: 'restoring' }
  /** A reconnect a lost transport asked for. */
  | { kind: 'reconnecting' }
  | { kind: 'disconnected'; reason: DisconnectReason }
  | { kind: 'closed' };

/** The parts of the state that belong to the active Pane. See paneFacts. */
type PaneFacts = Pick<AttachState, 'scrolled' | 'mouseTracking' | 'cursorRow'>;

/** A Pane no view has said anything about. */
const UNREAD_PANE: PaneFacts = { scrolled: null, mouseTracking: false, cursorRow: null };

/** Everything the Terminal Screen, the Host Screen and the Hosts list draw. */
export interface AttachState {
  phase: AttachPhase;
  /** Which Session is attached, held once and published from here. */
  sessionName: string;
  fingerprint: string;
  /**
   * Whether the Host's key is not the one last seen. Never blocks.
   *
   * A flag rather than a record: the Host's name is on the Attach and the key
   * it presented is the `fingerprint` beside this, so anything else here would
   * be the same two values written down twice.
   */
  keyChanged: boolean;
  topology: Topology;
  /** The Host's Sessions as of the last `%sessions-changed`, or null unread. */
  sessions: Session[] | null;
  /** Captured Pane text by target, filled in behind an already-open sheet. */
  previews: Map<string, string[]>;
  /** The last thing that went wrong that nobody was waiting on. */
  trouble: string | null;
  /** Whether the active Pane should fill the Window on its own. */
  zoomed: boolean;
  /** The grid the Client is sized to; the slot of a Surface spanning the Window takes its rows from it. */
  grid: Grid | null;
  /**
   * How far back the active Pane is being viewed, or null at the live bottom.
   *
   * Only the active Pane's: the others are on screen but nobody is driving
   * them, and an indicator per Pane says otherwise.
   */
  scrolled: ScrollPosition | null;
  /** Whether the application in the active Pane is listening for the mouse. */
  mouseTracking: boolean;
  /**
   * The row the active Pane's cursor is on, or null before it has been read.
   *
   * What the screen slides the Window by when the keyboard covers part of it;
   * see windowSlide. The active Pane's only, for the same reason as the
   * Scrollback position: one Window, one place being typed into.
   */
  cursorRow: number | null;
}

/** What the Key Row's ⌘v delivers: the clipboard's text, or its image as a staged file. */
export type Paste = { kind: 'text'; text: string } | { kind: 'image'; file: AttachmentFile };

/**
 * How long the program in a Pane has to answer `C-l` before the Scrollback is
 * dropped behind it.
 *
 * A shell answers by clearing its screen, and tmux moves a screen cleared
 * from the top into the Scrollback. Measured on tmux 3.8 down one Control
 * Connection: with no wait, `clear-history` ran first and the 24 lines came
 * back ten times out of ten; with 150 ms, none did.
 */
export const CLEAR_SETTLE_MS = 250;

export interface Attach {
  readonly hostId: string;
  readonly hostName: string;
  readonly composer: Composer;
  state(): AttachState;
  /** Called on every change, and once with the current state on subscribing. */
  subscribe(listener: (state: AttachState) => void): () => void;

  // The verbs the Options menu, the Key Row and the sheets need. Each
  // re-applies the Zoom preference and refreshes the Topology itself.
  switchSession(name: string): Promise<void>;
  selectWindow(index: number): Promise<void>;
  /**
   * Optimistic: moves the Pane here first and puts it back if refused.
   * Answers whether it moved.
   */
  selectPane(paneId: string): boolean;
  split(direction: 'right' | 'down'): Promise<void>;
  newWindow(): Promise<void>;
  setZoom(on: boolean): void;
  /** Fills in the previews for a sheet that is already open. */
  capturePreviews(targets: string[]): void;
  /** The active Pane's text, for the clipboard. Rejects with no Pane or no Connection. */
  capturePaneText(): Promise<string>;
  /**
   * Pastes into the active Pane and presses nothing after it: a paste is not
   * a send. An image goes up to the Host first, and its path is what is pasted.
   *
   * `runLines` is asked when the text has a line break and the program in the
   * Pane did not ask for bracketed paste, because that program takes each
   * line break as an Enter. Nothing is pasted when it answers false.
   */
  paste(content: Paste, runLines: () => Promise<boolean>): Promise<void>;
  /**
   * What ⌘K does in a terminal: the active Pane's screen and its Scrollback
   * go, and the program draws itself again.
   */
  clearPane(): Promise<void>;
  /** Re-reads the Host's Session list, which no notification describes. */
  refreshSessions(): void;
  /** Reads the Topology again. For a sheet correcting itself behind its own back. */
  refreshTopology(): void;
  /** The user asking for another go, from a disconnected phase. */
  reconnect(): void;

  // Per-Pane, for the views the screen puts Surfaces into.
  view(paneId: string): PaneView;
  /**
   * A Surface for a Pane came or went, and if it came, the grid it has
   * already reported, if it has.
   *
   * Both at once, because a Surface says its grid once per size and the
   * screen may be introducing an Attach to a Surface that said it long ago:
   * the Attach this screen belonged to was replaced under a Surface that did
   * not move. Told separately, the second Attach would wait for a report the
   * first one had.
   */
  surfaceForPane(paneId: string, surface: PaneSurface | null, grid?: Grid | null): void;
  /** A Pane's Surface reported its grid. */
  paneGridReported(paneId: string, grid: Grid): void;

  // The facts the screen and the root feed it.
  windowGridReported(grid: Grid, surface: Extent): void;
  containerLaidOut(container: Extent): void;
  spanningSurface(present: boolean): void;
  sheetPresented(open: boolean): void;
  lifecycleChanged(phase: LifecyclePhase): void;

  /** Ends it on purpose. Nothing fires afterwards. */
  close(): Promise<void>;
}

export interface AttachOptions {
  host: Host;
  sessionName: string;
  /** The Topic the Session was opened from, kept in the Last Place. */
  topicId: string | null;
  /** The Zoom preference this Session is opened with. */
  zoomed: boolean;
  openConnection: OpenConnection;
  store: HostStore;
  clock?: Clock;
  /** Where the Attach says what it did. Silent when nobody asked. */
  log?: Log;
}

/**
 * One Session, attached.
 *
 * Owns the SSH Connection, the trust-on-first-use verdict, the Control
 * Connection, the Client, the Client's size, the Topology store, the Session
 * name, the Zoom preference and one Pane view per Pane. Publishes all of it
 * through one subscription, takes facts and verbs, and ends with one
 * `close()` after which nothing fires.
 *
 * **It outlives the Terminal Screen.** The screen subscribes on mount and
 * unsubscribes on unmount and starts and stops nothing; going Home leaves the
 * Session attached and coming back repaints it from a fresh capture. What
 * ends an Attach is the user disconnecting, another Session being opened, or
 * a transport that was lost and could not be restored. See ADR 0007.
 *
 * **The order of an Attach is a property of this module.** Connect, read the
 * key verdict, wait for a grid that has stopped moving, open the Control
 * Connection with no PTY, make the Client and the Topology store, *size
 * first*, apply Zoom, read the Topology, read the Session list. Size first
 * because the capture that follows must be of a Pane the size of the Surface;
 * that used to be a comment above five lines in a component.
 *
 * **Cancellation is one number.** Every async step remembers the generation it
 * began in and does nothing if the Attach has been closed or replaced since.
 * That is the whole of what twenty `disposed` checks and a `background()` sink
 * used to do, and it is what makes "nothing fires after `close()`" a test
 * rather than a hope.
 *
 * **A reconnect is a replacement, not a repair.** The Connection, Control
 * Connection, Client and Topology store are closed and remade and the Pane
 * views re-created; the new Client is sized from the last *stable* grid, and
 * the Zoom preference is re-applied. To a subscriber it is a phase change.
 * Copied from `remux`, which makes a new runtime with a new instance id for
 * exactly this reason: nothing from the dead Connection survives to be believed.
 */
export function openAttach(options: AttachOptions): Attach {
  const { host, openConnection, store } = options;
  const clock = options.clock ?? systemClock;
  const log = options.log ?? silentLog;
  const say = speakingAs(log, 'attach');

  /**
   * Which Connection is current.
   *
   * Bumped by `close()` and by every replacement. An async step that began in
   * an earlier generation has nothing left to tell and nobody to tell it to.
   */
  let generation = 0;
  let closed = false;
  /** Whether the app is in the background, which gates every read and write. */
  let suspended = false;

  let connection: HostConnection | null = null;
  let control: ControlConnection | null = null;
  let client: TmuxClient | null = null;
  let topology: TopologyStore | null = null;

  /**
   * The two ways into a Pane that are not typing, on the Connection in force
   * now: an upload to the Host, and a paste through a tmux buffer. The
   * Composer's Send and the Key Row's ⌘v both go through this.
   *
   * `kept` ends each refusal with what became of the caller's text.
   */
  function openDelivery(kept: string) {
    const mine = generation;
    const current = client;
    const link = connection;
    if (!current) throw new Error(`The Connection changed.${kept}`);
    const check = () => {
      if (stale(mine) || suspended || client !== current || state.phase.kind !== 'connected') {
        throw new Error(`The Connection changed.${kept}`);
      }
    };
    check();
    const upload: Upload = (file, signal, progress) => {
      check();
      if (!link?.upload) throw new Error('This Connection cannot upload attachments.');
      return link.upload(file, signal, progress);
    };
    return {
      check,
      upload,
      /** `started` is called immediately before the command that reaches the Pane. */
      async paste(paneId: string, text: string, valid: () => void, started: () => void): Promise<void> {
        valid();
        const buffer = await current.preparePaste(text, `muxify-${uniqueId()}`, valid);
        try {
          valid();
          // Check that the captured Pane still exists, even after switching
          // Windows or Sessions. The current Topology only lists visible Panes.
          if (!await current.paneState(paneId)) throw new Error(`The destination Pane has gone.${kept}`);
          valid();
          started();
          say(`pasting into ${paneId} (${text.length} characters)`);
          await buffer.paste(paneId);
        } finally {
          await buffer.dispose().catch(() => {});
        }
      },
      pressEnter: (paneId: string) => current.sendKey(paneId, 'Enter'),
      paneState: (paneId: string) => current.paneState(paneId),
    };
  }

  const composer = createComposer((paneId) => {
    const delivery = openDelivery(' Draft kept.');
    return {
      upload: delivery.upload,
      async deliver(text, signal, started) {
        const valid = () => { checkAborted(signal); delivery.check(); };
        await delivery.paste(paneId, text, valid, started);
        // As in remux, let the receiving application settle its pasted text
        // before the separate Enter. Never replay either after a reconnect.
        await new Promise<void>((resolve) => setTimeout(resolve, 150));
        valid();
        await delivery.pressEnter(paneId);
      },
    };
  });

  /** Which automatic sources have already had their one attempt. */
  const attempted = new Set<ReconnectSource>();

  const views = new Map<string, PaneView>();
  /**
   * What the screen has put on screen for each Pane: its Surface, and the last
   * grid that Surface reported.
   *
   * Kept here rather than in the screen because a replacement re-creates every
   * view, and a fresh view knows neither. Both halves or neither: a view given
   * a Surface and never told a grid is a view that waits forever, which is the
   * same bug the Pane view was deepened to close — only one level up.
   */
  const onScreen = new Map<string, { surface: PaneSurface; grid: Grid | null }>();
  /**
   * Panes whose output arrived with no view to take it, once each.
   *
   * Only Panes of the Window on screen are worth a line: tmux pushes output
   * for every Pane in the Session, and the ones in other Windows have no view
   * on purpose. One that is on screen and has none is a Pane going blank.
   */
  const unheard = new Set<string>();

  const listeners = new Set<(state: AttachState) => void>();
  let state: AttachState = {
    phase: { kind: 'connecting' },
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
    cursorRow: null,
  };

  const sizing: ClientSizing = createClientSizing(async (grid) => {
    const current = client;
    // Thrown, not shrugged off: the sizing module must not record a size it
    // never sent, or it will skip the next request for the same one.
    if (!current) throw new Error('no Client to resize');
    await current.resizeClient(grid);
  }, { clock, onSettled: (grid) => change({ grid }), log });

  function publish(): void {
    for (const listener of [...listeners]) listener(state);
  }

  function change(over: Partial<AttachState>): void {
    if (closed && over.phase?.kind !== 'closed') return;
    noteChange(over);
    state = { ...state, ...over };
    publish();
  }

  /**
   * The facts a subscriber would notice, written down as they change.
   *
   * Not every field: the cursor row and the Scrollback position move with
   * every burst of output, and a Log full of them is a Log with nothing else
   * left in it.
   */
  function noteChange(over: Partial<AttachState>): void {
    if (over.phase && over.phase.kind !== state.phase.kind) {
      say(
        over.phase.kind === 'disconnected'
          ? `phase disconnected: ${over.phase.reason.kind} — ${over.phase.reason.detail}`
          : `phase ${over.phase.kind}`,
      );
    }
    if (over.sessionName !== undefined && over.sessionName !== state.sessionName) {
      say(`Session is now ${over.sessionName}`);
    }
    if (over.trouble && over.trouble !== state.trouble) say(`trouble: ${over.trouble}`);
    if (over.grid && !sameGrid(over.grid, state.grid)) {
      say(`Client grid ${over.grid.cols}x${over.grid.rows}`);
    }
    if (over.mouseTracking !== undefined && over.mouseTracking !== state.mouseTracking) {
      say(`mouse tracking ${over.mouseTracking ? 'on' : 'off'} in the active Pane`);
    }
    if (over.zoomed !== undefined && over.zoomed !== state.zoomed) {
      say(`Zoom preference ${over.zoomed ? 'on' : 'off'}`);
    }
    if (over.keyChanged && !state.keyChanged) say('the Host presented a different key');
  }

  /** True when this step began before the current Connection. */
  function stale(mine: number): boolean {
    return closed || mine !== generation;
  }

  /**
   * Runs something nobody is waiting on, and owns how it can fail.
   *
   * Every one of these is a round trip started and then stopped caring about,
   * and a Control Command rejects when the channel is gone — that is the
   * contract. Once closed or replaced there is nothing left to tell, so it is
   * dropped. While the Attach is up, a command that failed is worth the same
   * quiet line as one typed into a Pane that has gone.
   */
  function background(mine: number, work: () => Promise<unknown>): void {
    void work().catch((error: unknown) => {
      if (stale(mine)) return;
      change({ trouble: describeError(error) });
    });
  }

  // ---------------------------------------------------------------- Pane views

  /**
   * What each view last said about its Pane, for every Pane and not only the
   * active one.
   *
   * The state holds these three for the active Pane. A view says each one when
   * it changes and not again when its Pane becomes the active one, so the
   * state takes them from here when the active Pane changes. Without this, a
   * Pane picked after one that listens for the mouse kept the mouse layer.
   */
  const paneFacts = new Map<string, PaneFacts>();

  function paneSaid(mine: number, paneId: string, fact: Partial<PaneFacts>): void {
    if (stale(mine)) return;
    paneFacts.set(paneId, { ...(paneFacts.get(paneId) ?? UNREAD_PANE), ...fact });
    if (paneId === state.topology.activePane?.id) change(fact);
  }

  function viewFor(paneId: string): PaneView {
    const existing = views.get(paneId);
    if (existing) return existing;

    const mine = generation;
    /** The Client as it is now, refused once this view's Connection is over. */
    const reading = () => {
      if (stale(mine) || !client) throw new Error('the Connection has gone');
      return client;
    };
    const active = () => paneId === state.topology.activePane?.id;

    const view = createPaneView(
      paneId,
      {
        paneState: (id) => reading().paneState(id),
        capturePane: (id) => reading().capturePane(id),
        captureScrollback: (id, start, end) => reading().captureScrollback(id, start, end),
        captureSelection: (id, start, end) => reading().captureSelection(id, start, end),
        // Input is what says the phone is the one in use, so it is what takes
        // the Window back from a laptop that resized it.
        sendKeys: (id, bytes) => {
          sizing.reclaim();
          return reading().sendKeys(id, bytes);
        },
        sendKey: (id, key) => {
          sizing.reclaim();
          return reading().sendKey(id, key);
        },
      },
      {
        onScroll: (position) => paneSaid(mine, paneId, { scrolled: position }),
        onMouseTracking: (wanted) => paneSaid(mine, paneId, { mouseTracking: wanted }),
        onCursor: (row) => paneSaid(mine, paneId, { cursorRow: row }),
        // A Pane that painted is a Pane that is talking to the Host again,
        // which is the honest moment to take a line of trouble down.
        onPainted: () => {
          if (!stale(mine)) change({ trouble: null });
        },
        onError: (error) => {
          if (!stale(mine)) change({ trouble: describeError(error) });
        },
      },
      { clock, log },
    );
    views.set(paneId, view);
    unheard.delete(paneId);
    const shown = onScreen.get(paneId);
    say(
      `view for ${paneId} created` +
        (shown
          ? `, over a Surface that ${shown.grid ? `reported ${shown.grid.cols}x${shown.grid.rows}` : 'has not reported'}`
          : ', with no Surface yet'),
    );
    if (shown) {
      view.setSurface(shown.surface);
      if (shown.grid) view.reportGrid(shown.grid);
    }
    view.setPaused(suspended);
    view.setActive(active());
    return view;
  }

  /**
   * Brings the views into line with the Panes the Topology now has.
   *
   * Three things at once, because they are one question — which Panes are on
   * screen. A Pane that has left (a Window switch, a kill on the laptop)
   * releases its view. A Pane that is still there and has a Surface but no
   * view *gets one*, which is what re-creates every view after a replacement:
   * the Surfaces belong to the screen and did not go anywhere, so a fresh view
   * over the same Surface resyncs it from a fresh capture exactly as a first
   * paint does. And one cursor, in the Pane the keyboard is in — remembered by
   * each view so a repaint does not bring a second one back.
   *
   * The Surface itself is *kept* when its Pane leaves. It is the screen's, and
   * the screen says when it goes — and the screen may not agree that it has:
   * React folds two Topologies published in one turn into one render, so a
   * Pane that left and came back between them has a Surface that never
   * unmounted. Forgetting it here left that Surface with no view, which is a
   * Pane showing nothing that no tap or byte could ever reach again.
   */
  function pruneViews(next: Topology): void {
    const wanted = new Set(next.panes.map((pane) => pane.id));
    for (const [id, view] of [...views]) {
      if (wanted.has(id)) continue;
      say(`${id} left the Topology; its view is released${onScreen.has(id) ? ', Surface kept' : ''}`);
      view.dispose();
      views.delete(id);
      paneFacts.delete(id);
    }
    for (const id of onScreen.keys()) {
      if (wanted.has(id)) viewFor(id);
    }
    for (const [id, view] of views) view.setActive(id === next.activePane?.id);
  }

  /** Disposes every view but keeps the Surfaces, which the screen still holds. */
  function releaseViews(): void {
    if (views.size > 0) say(`releasing ${views.size} views; ${onScreen.size} Surfaces kept`);
    for (const view of views.values()) view.dispose();
    views.clear();
    paneFacts.clear();
  }

  /**
   * Records a Session the user is now in: a Recent Session, and the Last Place
   * a cold start goes back to. One after the other, because each rewrites the
   * whole records file and two at once would lose one of them.
   */
  function arrived(sessionName: string, topicId: string | null): void {
    void store
      .rememberSession(host.id, sessionName)
      .then(() => store.rememberLastPlace({ hostId: host.id, session: sessionName, topicId }))
      .catch(() => {});
  }

  // ------------------------------------------------------------------- Attach

  async function connect(): Promise<void> {
    const mine = generation;
    try {
      say(`connecting to ${host.displayName} (${host.address}:${host.port}) for ${state.sessionName}`);
      const opened = await openConnection(host);
      if (stale(mine)) {
        say('Connection opened after it was no longer wanted; closing it');
        await opened.close();
        return;
      }
      connection = opened;
      say(`Connection open; Host key ${opened.verdict.kind}`);
      opened.suspected?.(() => checkLink(mine));

      // Trust on first use: remember the key the first time, and say so loudly
      // when it changes. The Connection is not blocked either way — someone
      // who has just rebuilt a machine still has to reach it.
      if (opened.verdict.kind === 'first-sight') {
        await store.rememberFingerprint(host.id, opened.fingerprint);
      }
      if (stale(mine)) return;
      change({
        fingerprint: opened.fingerprint,
        keyChanged: opened.verdict.kind === 'changed',
      });

      // Sized from a grid that has stopped moving, not merely the latest. The
      // Surface reports one while the Key Row's glass is still being measured
      // and a smaller one once the Key Row has taken its height; the first
      // would leave tmux drawing a taller Window than the Surface has.
      if (!sizing.stableGrid()) say('waiting for a grid that has stopped moving');
      const settled = await sizing.settledGrid();
      if (stale(mine)) return;
      say(`opening the Control Connection at ${settled.cols}x${settled.rows}`);

      // This is Attach: one channel, no PTY, and no Session option touched.
      const opening = await openControlConnection(
        opened.transport,
        { sessionName: state.sessionName, tmuxExecutablePath: host.tmuxExecutablePath, log },
        {
          // Straight to the Pane it belongs to. A Window that is not zoomed
          // has a view for each of them, and this is the thing an attached
          // client could not do: its byte stream is one composited Window.
          onOutput: (pane, bytes) => {
            if (stale(mine)) return;
            const view = views.get(pane);
            if (view) {
              view.receive(bytes);
              return;
            }
            // Worth a line only for a Pane that should have one; see unheard.
            if (unheard.has(pane) || !state.topology.panes.some((each) => each.id === pane)) return;
            unheard.add(pane);
            say(`output for ${pane}, which is in the Window but has no view (${bytes.length} bytes)`);
          },
          onNotification: (event) => {
            if (stale(mine)) return;
            if (event.kind === 'session-changed') {
              topology?.attachedTo(event.name);
              change({ sessionName: event.name });
            }
            if (event.kind === 'sessions-changed') refreshSessions();
            topology?.apply(event);
          },
          // A Connection lost while nobody is looking is the foreground check's
          // business rather than the transport-loss policy's: reconnecting
          // into a suspended app costs the Host a Connection nothing draws.
          onClosed: (detail, cause) =>
            ended(mine, reasonForClosure(cause, detail), suspended ? null : 'transport-loss'),
        },
      );
      if (stale(mine)) {
        await opening.close();
        return;
      }

      control = opening;
      client = new TmuxClient(opening);
      topology = createTopologyStore(client, state.sessionName, {
        onTrouble: (error) => {
          if (!stale(mine)) change({ trouble: describeError(error) });
        },
        log,
      });
      // Publishing the Topology is all that is needed: the Surfaces on screen
      // are derived from it, so a split made on the laptop, a Window switch or
      // somebody else's `select-pane` all arrive the same way.
      let windowSize: Grid | null = null;
      topology.subscribe((next) => {
        if (stale(mine)) return;
        pruneViews(next);
        const activeId = next.activePane?.id;
        change({
          topology: next,
          ...(activeId !== state.topology.activePane?.id
            ? (paneFacts.get(activeId ?? '') ?? UNREAD_PANE)
            : {}),
        });
        const size = windowGrid(next);
        if (!size) return;
        sizing.windowSized(size);
        // A Window that changed size has its Panes drawn for the old width,
        // and their output does not redraw all of it. Captures do.
        if (windowSize && !sameGrid(size, windowSize)) {
          say(`Window resized to ${size.cols}x${size.rows}; resyncing every Pane`);
          for (const view of views.values()) view.resync();
        }
        windowSize = size;
      });

      change({ phase: { kind: 'connected' } });
      // A Connection that reached here has cleared whatever ended the last
      // one, so both automatic sources get their attempt again.
      attempted.clear();

      // Stamped on a Session that actually opened, not on one that was only
      // tapped: the Host Screen's order is a record of where you have been,
      // and a Session that refused to attach is not somewhere you have been.
      arrived(state.sessionName, options.topicId);

      // Size first, so the capture that follows is of a Pane the size of the
      // Surface rather than of whatever the last Client left it.
      sizing.attached();
      // A phone is too narrow for side-by-side Panes, so a split Session
      // arrives with its active Pane filling the Window.
      await client.setZoom(state.sessionName, state.zoomed);
      if (stale(mine)) return;
      say(`Zoom preference ${state.zoomed ? 'on' : 'off'} applied; reading the Topology`);
      await topology.refresh();
      if (stale(mine)) return;
      refreshSessions();
    } catch (error) {
      if (stale(mine)) return;
      say(`connect failed: ${describeError(error)}`);
      // Two stages, two vocabularies. Before the Control Connection is open
      // the failure is the SSH library's; after it, it is tmux's own words.
      const reason = connection === null ? reasonForConnectFailure(error) : reasonForAttachFailure(error);
      ended(mine, reason, suspended ? null : 'transport-loss');
    }
  }

  /**
   * The Connection is over.
   *
   * Everything belonging to it is closed and let go before the phase is
   * published, so a subscriber that reacts by reconnecting cannot find a
   * half-open Connection underneath.
   */
  function ended(
    mine: number,
    reason: DisconnectReason,
    source: ReconnectSource | null,
  ): void {
    if (stale(mine)) return;
    say(
      `Connection ended: ${reason.kind} — ${reason.detail}` +
        (source === null ? '; no automatic reconnect' : `; ${source} may reconnect`),
    );
    // Not awaited: a Connection that has already ended has nothing to wait
    // for, and a reconnect must not be held up by a socket that will not shut.
    void teardown();
    change({ phase: { kind: 'disconnected', reason } });
    if (source !== null) tryReconnect(source);
  }

  /**
   * Closes the Connection and everything made from it. Keeps the sizing.
   *
   * Answers when the socket is actually shut, which `close()` waits for and a
   * replacement does not: the holder promises that a Session is gone before
   * the next one is opened, and a Host with two Clients sizing it is exactly
   * what holding one Attach at a time is meant to prevent.
   */
  function teardown(): Promise<void> {
    composer.interrupt();
    const closingControl = control;
    const closingConnection = connection;
    control = null;
    client = null;
    topology?.dispose();
    topology = null;
    releaseViews();
    // Errors on the way out go nowhere on purpose: this Connection is already
    // over, and a Host that will not be said goodbye to politely is a Host the
    // socket drops anyway.
    // A close on purpose gives the Connection back for the screens to use. Any
    // other end is a loss or a replacement, and the next Connection must be new.
    const onPurpose = closed;
    return (async () => {
      try {
        await closingControl?.close();
      } finally {
        await (onPurpose || !closingConnection?.discard
          ? closingConnection?.close()
          : closingConnection.discard());
      }
    })().catch(() => {});
  }

  /** A screen found the Connection slow. The control channel says whether it is alive. */
  function checkLink(mine: number): void {
    if (stale(mine) || state.phase.kind !== 'connected') return;
    if (control?.isOpen() ?? false) {
      say('a screen found the Connection slow; the link is still open');
      return;
    }
    ended(
      mine,
      { kind: 'transport-lost', detail: 'A read on this Connection did not answer in time' },
      suspended ? null : 'transport-loss',
    );
  }

  /**
   * One automatic attempt per source, until the next connected phase.
   *
   * `remux`'s rule exactly, and the reason it is a rule rather than an
   * emergent loop: two sources can fire for the same drop — the channel
   * closing and the app coming back to find it closed — and a retry that
   * forgets it has already tried is a Muxify that hammers a Host which is
   * refusing.
   */
  function tryReconnect(source: ReconnectSource): void {
    if (closed) return;
    if (state.phase.kind !== 'disconnected') return;
    if (!retryCouldWork(state.phase.reason)) {
      say(`not reconnecting (${source}): trying again could not work`);
      return;
    }
    if (attempted.has(source)) {
      say(`not reconnecting (${source}): it has had its attempt`);
      return;
    }
    attempted.add(source);
    replace(source === 'foreground' ? { kind: 'restoring' } : { kind: 'reconnecting' });
  }

  /** A fresh Connection under the same Attach. */
  function replace(phase: AttachPhase): void {
    generation += 1;
    say(`replacing the Connection (generation ${generation})`);
    void teardown();
    connection = null;
    change({ phase });
    void connect();
  }

  // ------------------------------------------------------------------- Reading

  function refreshSessions(): void {
    const mine = generation;
    const current = client;
    if (!current || suspended) return;
    void (async () => {
      try {
        const listed = await current.listSessions();
        // Checked again on the way back, not only on the way out: a read that
        // was in flight when the app was suspended is a read whose answer
        // nobody is looking at, and publishing it is drawing.
        if (!stale(mine) && !suspended) {
          say(`${listed.length} Sessions on the Host`);
          change({ sessions: listed });
        }
      } catch (error) {
        // A Session list that will not read is a picker with nothing new in
        // it, not a Connection worth taking down.
        if (!stale(mine)) say(`the Session list would not read: ${describeError(error)}`);
      }
    })();
  }

  /** Re-applies the Zoom preference and reads the Topology. Every verb ends here. */
  async function settleAfterVerb(mine: number): Promise<void> {
    const current = client;
    if (!current || stale(mine)) return;
    // Selecting a Pane drops tmux out of zoom, and moving to another Window
    // lands on one nobody has zoomed, so the preference is re-applied rather
    // than assumed to have survived.
    await current.setZoom(state.sessionName, state.zoomed);
    if (stale(mine)) return;
    await topology?.refresh();
  }

  const attach: Attach = {
    hostId: host.id,
    hostName: host.displayName,
    composer,

    state: () => state,

    subscribe(listener: (next: AttachState) => void): () => void {
      listeners.add(listener);
      listener(state);
      return () => {
        listeners.delete(listener);
      };
    },

    async switchSession(name: string): Promise<void> {
      const mine = generation;
      const current = client;
      if (!current || name === state.sessionName) return;
      say(`switching to Session ${name}`);
      await current.switchSession(name);
      if (stale(mine)) return;
      topology?.attachedTo(name);
      change({ sessionName: name });
      // Switching lands in a Session just as arriving does, so it counts the
      // same on the Host Screen. Without this the order would only remember
      // how a visit started, not where it went. The Topic it was opened from
      // need not hold the Session switched to, so the Last Place drops it.
      arrived(name, null);
      // The Session switched into has its own Window, sized for whoever
      // attached to it last.
      sizing.sessionSwitched();
      await settleAfterVerb(mine);
    },

    async selectWindow(index: number): Promise<void> {
      const mine = generation;
      const current = client;
      if (!current) return;
      say(`selecting Window ${index}`);
      await current.selectWindow(state.sessionName, index);
      await settleAfterVerb(mine);
    },

    selectPane(paneId: string): boolean {
      const mine = generation;
      const current = client;
      const model = topology;
      const pane = state.topology.panes.find((each) => each.id === paneId);
      const windowIndex = state.topology.activeWindow?.index;
      if (!current || !model || !pane || windowIndex === undefined || pane.active) {
        say(
          `selecting Pane ${paneId} did nothing: ${
            !current
              ? 'no Client'
              : !pane
                ? 'not in the Topology'
                : windowIndex === undefined
                  ? 'no active Window'
                  : 'it is already active'
          }`,
        );
        return false;
      }
      say(`selecting Pane ${paneId} (index ${pane.index}) in Window ${windowIndex}`);
      // Moved here first, then asked for. The cursor, the keyboard and the
      // Panes sheet all follow the Topology, so doing it in this order is the
      // difference between a tap that lands and one that lands a round trip
      // later. tmux's own `%window-pane-changed` arrives after and agrees.
      //
      // The one verb that settles nothing afterwards, and that is the point.
      // Zoom rides along in the command — `select-pane -Z`, so tmux carries it
      // across rather than dropping it for Muxify to put back — and the
      // Topology arrives in the notifications tmux sends of its own accord. A
      // read here would be a round trip the tap is waiting on for no answer it
      // does not already have.
      model.activate(paneId);
      void (async () => {
        try {
          await current.selectPane(state.sessionName, windowIndex, pane.index);
        } catch (error) {
          if (stale(mine)) return;
          change({ trouble: describeError(error) });
          // The move was made on a guess the Host has just refused, so the
          // guess is thrown away rather than left showing.
          await model.refresh();
        }
      })();
      return true;
    },

    async split(direction: 'right' | 'down'): Promise<void> {
      const mine = generation;
      const current = client;
      if (!current) return;
      say(`splitting ${direction}`);
      await current.splitWindow(state.sessionName, direction);
      await settleAfterVerb(mine);
    },

    async newWindow(): Promise<void> {
      const mine = generation;
      const current = client;
      if (!current) return;
      say('adding a Window');
      await current.newWindow(state.sessionName);
      await settleAfterVerb(mine);
    },

    setZoom(on: boolean): void {
      const mine = generation;
      say(`Zoom switch → ${on ? 'on' : 'off'}`);
      change({ zoomed: on });
      background(mine, async () => {
        const current = client;
        if (!current) return;
        await current.setZoom(state.sessionName, on);
        if (stale(mine)) return;
        await topology?.refresh();
      });
    },

    capturePreviews(targets: string[]): void {
      const mine = generation;
      const current = client;
      if (!current || targets.length === 0 || suspended) return;
      void (async () => {
        try {
          const fresh = await current.capturePanes(targets);
          if (stale(mine) || suspended || fresh.size === 0) return;
          change({ previews: new Map([...state.previews, ...fresh]) });
        } catch {
          // Previews that will not read leave the sheet showing the ones it
          // opened with, which is the same thing it shows before any land.
          // Not worth a line of trouble over, and not the Connection's fault.
        }
      })();
    },

    async capturePaneText(): Promise<string> {
      const current = client;
      const pane = state.topology.activePane;
      if (!current) throw new Error('Not connected.');
      if (!pane) throw new Error('No active Pane.');
      say(`copying the text of ${pane.id}`);
      return current.capturePaneText(pane.id);
    },

    async paste(content: Paste, runLines: () => Promise<boolean>): Promise<void> {
      const pane = state.topology.activePane;
      if (!pane) throw new Error('No active Pane.');
      const delivery = openDelivery('');
      const text =
        content.kind === 'text'
          ? content.text
          : shellQuote(await delivery.upload(content.file, new AbortController().signal, () => {}));
      if (/[\r\n]/.test(text)) {
        const program = await delivery.paneState(pane.id);
        if (program && !program.bracketedPaste && !(await runLines())) return;
      }
      await delivery.paste(pane.id, text, delivery.check, () => {});
    },

    async clearPane(): Promise<void> {
      const mine = generation;
      const current = client;
      const pane = state.topology.activePane;
      if (!current) throw new Error('Not connected.');
      if (!pane) throw new Error('No active Pane.');
      say(`clearing ${pane.id}`);
      await current.sendKey(pane.id, 'C-l');
      await new Promise<void>((resolve) => clock.after(CLEAR_SETTLE_MS, resolve));
      if (stale(mine)) return;
      await current.clearHistory(pane.id);
      // A Surface that shows the Scrollback shows lines that are gone now.
      views.get(pane.id)?.jumpToLatest();
    },

    refreshSessions,

    refreshTopology(): void {
      const mine = generation;
      if (suspended) return;
      say('re-reading the Topology for a sheet');
      background(mine, async () => {
        await topology?.refresh();
      });
    },

    reconnect(): void {
      if (closed || state.phase.kind !== 'disconnected') return;
      say('reconnect asked for by the user');
      // The user asking, so the once-per-source rule does not apply — that is
      // there to stop Muxify looping, not to stop a person trying again.
      replace({ kind: 'reconnecting' });
    },

    view: viewFor,

    surfaceForPane(paneId: string, surface: PaneSurface | null, grid: Grid | null = null): void {
      if (closed) return;
      if (surface === null) {
        say(`Surface for ${paneId} left`);
        onScreen.delete(paneId);
        views.get(paneId)?.setSurface(null);
        return;
      }
      say(
        `Surface for ${paneId} arrived` +
          (grid ? `, having reported ${grid.cols}x${grid.rows}` : ', not yet reported') +
          (views.has(paneId) ? '' : '; no view for it yet') +
          (state.topology.panes.some((each) => each.id === paneId) ? '' : '; not in the Topology'),
      );
      // The grid is the Surface's own or nothing: a Surface that has not
      // reported yet says so as soon as it is laid out, and the grid the one
      // before it reported is not this one's.
      onScreen.set(paneId, { surface, grid });
      const existing = views.get(paneId);
      if (!existing) {
        // Made from what is on screen, which is both halves at once.
        viewFor(paneId);
        return;
      }
      existing.setSurface(surface);
      if (grid) existing.reportGrid(grid);
    },

    paneGridReported(paneId: string, grid: Grid): void {
      if (closed) return;
      const shown = onScreen.get(paneId);
      if (shown) shown.grid = grid;
      const view = views.get(paneId);
      if (!view) say(`grid ${grid.cols}x${grid.rows} for ${paneId}, which has no view to paint`);
      view?.reportGrid(grid);
    },

    windowGridReported(grid: Grid, surface: Extent): void {
      if (closed) return;
      sizing.windowGridReported(grid, surface);
      change({ grid: sizing.stableGrid() });
    },

    containerLaidOut: (extent: Extent) => sizing.containerLaidOut(extent),
    spanningSurface: (present: boolean) => sizing.spanningSurface(present),
    sheetPresented: (open: boolean) => sizing.sheetPresented(open),

    lifecycleChanged(phase: LifecyclePhase): void {
      if (closed) return;
      if (phase === 'background') {
        // Nothing on the wire, nothing drawn, and no background task: whether
        // the socket survives suspension is iOS's decision, and the foreground
        // check is what answers it. See ADR 0007.
        say('app in the background; suspended');
        suspended = true;
        composer.interrupt();
        for (const view of views.values()) view.setPaused(true);
        return;
      }
      // `inactive` is the moment between — a notification shade, the app
      // switcher — and means nothing has happened yet.
      if (phase !== 'active') return;
      if (!suspended) return;
      suspended = false;
      say('app active again; resumed');
      for (const view of views.values()) view.setPaused(false);

      if (state.phase.kind === 'disconnected') {
        // It died while nobody was looking. Coming back is the opportunity.
        tryReconnect('foreground');
        return;
      }
      if (state.phase.kind !== 'connected') return;
      // Asked of the transport rather than assumed. A Surface that looks
      // connected after a suspension is a Surface that may be talking to
      // nothing, and only the thing underneath can say which.
      if (control?.isOpen() ?? false) {
        say('the link survived the background');
        return;
      }
      ended(
        generation,
        { kind: 'transport-lost', detail: 'The Connection did not survive the background' },
        'foreground',
      );
    },

    async close(): Promise<void> {
      if (closed) return;
      say('closed on purpose');
      closed = true;
      composer.dispose();
      generation += 1;
      sizing.dispose();
      onScreen.clear();
      listeners.clear();
      state = { ...state, phase: { kind: 'closed' } };
      // Awaited, so that "this Session is gone" is true by the time this
      // resolves. The holder opens the next one on the strength of it.
      await teardown();
    },
  };

  // Opened, not merely constructed: an Attach with a Session name and a Host
  // is already on its way, and a caller that had to remember to start it is a
  // caller that can forget to.
  void connect();

  return attach;
}
