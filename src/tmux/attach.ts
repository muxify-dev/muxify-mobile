import { silentLog, speakingAs, type Log } from '@/diagnostics/log';
import { createComposer, type Composer } from '@/composer/composer';
import { type AttachmentFile, type Upload } from '@/composer/types';
import type { Clock } from '@/lib/clock';
import { describeError } from '@/lib/describe-error';
import { sameTyping, typingOf, type Typing } from '@/domain/typing';
import { systemClock } from '@/lib/clock';
import type { KeyVerdict } from '@/ssh/host-key';
import type { Host, PlaceTab, TopicPlace } from '@/storage/records';
import type { HostStore } from '@/storage/store';
import type { TopicId } from '@/topics/environment';
import { lastTopic, loadingTopic, settledTopic, topicStartingFrom, type TopicDetail, type TopicRead, type TopicView } from '@/topics/topic-detail';

import { toDraftText, type InputNotice, type Key } from './input-lane';
import { createOutbox } from './input-outbox';
import { createVerbGuard, describeVerb, type Verb } from './verb-guard';

export interface TopicOrigin { id: TopicId; seed: TopicDetail | null }
export interface SessionDestination {
  sessionName: string;
  /** Null is a plain Session pick. An origin explicitly selects that Topic. */
  topic: TopicOrigin | null;
  /**
   * Set when a Topic is opened: its Topic Place, to go back to once the Session
   * is attached. Only for this Topic and this Session; anything else is ignored.
   */
  restore?: TopicPlace | null;
}
export interface AttachedTopic { id: TopicId; view: TopicView }

import { createClientSizing, type ClientSizing } from './client-sizing';
import { shellQuote, type PaneColours, type PaneDirection } from './commands';
import {
  openControlConnection,
  type ClosedCause,
  type ControlConnection,
} from './control-connection';
import type { ControlEvent } from './control-protocol';
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
import { sameGrid, TmuxClient, type Grid, type Session, type Window } from './tmux-client';

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

/**
 * How far a first connect has gone, for the Connection Screen's step list.
 * The SSH steps come from the Connection; `attaching` is the Attach's own.
 */
export type ConnectStep = 'connecting' | 'checking-host-key' | 'signing-in' | 'attaching';

/**
 * Opens one. Where the SSH library lives, and the one thing tests replace.
 * `progress` hears the SSH steps when this opens a new link, and nothing when
 * it gives back one that is already open.
 */
export type OpenConnection = (host: Host, progress?: (step: ConnectStep) => void) => Promise<HostConnection>;

/** What the app is doing, as React Native reports it. */
export type LifecyclePhase = 'active' | 'inactive' | 'background';

/**
 * A Pane view's read while no Connection is there. The status Banner already
 * says that, so it is not a line of trouble.
 */
class NoConnection extends Error {
  constructor() {
    super('the Connection has gone');
  }
}

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
type PaneFacts = Pick<AttachState, 'scrolled' | 'mouseTracking' | 'rowInSight' | 'alternate'>;

/** A Pane no view has said anything about. */
const UNREAD_PANE: PaneFacts = { scrolled: null, mouseTracking: false, rowInSight: null, alternate: false };

/** Everything the Terminal Screen, the Host Screen and the Hosts list draw. */
export interface AttachState {
  phase: AttachPhase;
  /** Whether keys reach the active Pane now. See typingOf. */
  typing: Typing;
  /** How far the current connect has gone. `attaching` once the Connection is open. */
  step: ConnectStep;
  /**
   * The Panes whose Surface on screen this Attach has painted.
   *
   * A Pane leaves the set when its Surface goes or is replaced, because a new
   * Surface is blank. A reconnect keeps the set, as it keeps the Surfaces and
   * the content on them. The Terminal Screen shows no Surface until its Pane
   * is here.
   */
  painted: ReadonlySet<string>;
  /** Whether this Attach has painted any Pane yet: the Cover keeps content only after it has. */
  paintedOnce: boolean;
  /** Which Session is attached, held once and published from here. */
  sessionName: string;
  topic: AttachedTopic | null;
  fingerprint: string;
  /**
   * Whether the Host's key is not the one last seen, and the user has not
   * accepted it. Typing stays closed while it is true; see acceptHostKey.
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
   * The row of the active Pane the keyboard must not cover, or null before it
   * has been read. The cursor's, or the last row of a full-screen program.
   *
   * What the screen slides the Window by when the keyboard covers part of it;
   * see windowSlide. The active Pane's only, for the same reason as the
   * Scrollback position: one Window, one place being typed into.
   */
  rowInSight: number | null;
  /** Whether the active Pane uses the alternate screen. */
  alternate: boolean;
  /**
   * Typed keys that the user must know about: held for a decision, discarded,
   * or waiting for a Connection. For every Pane, also one in a Window that is
   * not on screen, because its keys wait all the same.
   */
  input: InputNotice[];
  /**
   * The Topic Place's Browser Tab, which a Topic opened just now had on top.
   * The Web View that the opener pushed with it checks it, once, against the
   * Tabs the Host lists: see takeTabToRestore.
   */
  tabToRestore: ShownTab | null;
}

/** A Browser Tab the Web View shows, under the token showTab gave it. */
export interface ShownTab {
  token: number;
  tab: PlaceTab;
}

/**
 * How old a typed key can be and still go to its Pane after a break without a
 * question. A start value: long enough for one reconnect, short enough that
 * the user still knows what was typed.
 */
const INPUT_TTL_MS = 30_000;

/** What the Key Row's ⌘v delivers: the clipboard's text, or its image as a staged file. */
export type Paste = { kind: 'text'; text: string } | { kind: 'image'; file: AttachmentFile };

export interface Attach {
  readonly hostId: string;
  readonly hostName: string;
  readonly composer: Composer;
  state(): AttachState;
  /** Called on every change, and once with the current state on subscribing. */
  subscribe(listener: (state: AttachState) => void): () => void;

  // The verbs the Options menu, the Key Row and the sheets need. Each
  // re-applies the Zoom preference and refreshes the Topology itself.
  switchSession(destination: SessionDestination): Promise<void>;
  /**
   * A screen shows the Topic: its header, the Title Sheet or both. While one
   * does, the Attach holds a `topic` subscription on the Host Server and
   * draws each push. Answers the way to stop showing it, which ends the
   * subscription when no other screen shows the Topic.
   */
  showTopic(): () => void;
  /** Follows the Topic again with a new subscription: the Title Sheet's Retry. */
  refreshTopic(): void;
  /**
   * The Terminal Screen came into focus: Unread on visit for the Topic of the
   * Session shown, once the Session is attached. A Session in no Topic sends
   * nothing.
   */
  terminalFocused(): void;
  selectWindow(index: number): Promise<void>;
  /**
   * Optimistic: moves the Pane here first and puts it back if refused.
   * Answers whether it moved.
   */
  selectPane(paneId: string): boolean;
  /** The Pane beside the active one. tmux finds it, and wraps at the edge. */
  selectPaneToward(direction: PaneDirection): void;
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
   * The paste goes into the Pane's Outbox Lane, after the keys typed before it.
   *
   * `runLines` is asked when the text has a line break and the program in the
   * Pane did not ask for bracketed paste, because that program takes each
   * line break as an Enter. Nothing is pasted when it answers false.
   */
  paste(content: Paste, runLines: () => Promise<boolean>): Promise<void>;
  /**
   * What ⌘K does in a terminal: the active Pane's screen and its Scrollback
   * go, and the program draws itself again. It goes into the active Pane's
   * Lane like a key, so it waits for a Connection like one.
   */
  clearPane(): void;
  /** Re-reads the Host's Session list, which no notification describes. */
  refreshSessions(): void;
  /** Reads the Topology again. For a sheet correcting itself behind its own back. */
  refreshTopology(): void;
  /** The user asking for another go, from a disconnected phase. */
  reconnect(): void;
  /** The user accepting the key the Host presented: it is remembered, and Typing opens. */
  acceptHostKey(): Promise<void>;
  /**
   * What the user decided about a Pane's held keys: send them, move their
   * text to the Pane's Draft, or throw them away. A Composer message among
   * them is its Draft already: compose keeps that Draft, and discard empties
   * it. False when nothing was done: the Pane holds no keys, or its Draft is
   * uploading attachments.
   */
  heldInput(paneId: string, action: 'send' | 'compose' | 'discard'): boolean;
  /**
   * What the user decided about a Pane's discarded keys: dismiss the notice,
   * or move the Draft of the message among them into the active Pane's
   * Draft. That Draft can be of a Pane that is gone, which the user cannot
   * open. False when nothing was moved.
   */
  discardedInput(paneId: string, action: 'dismiss' | 'compose'): boolean;

  // The Web View's Browser Tab, which the Topic Place keeps.
  /** The Web View shows this Tab now. Answers the token for the other two. */
  showTab(tab: PlaceTab): number;
  /** Where the page is now. Does nothing for a stale token. */
  updateTab(token: number, at: Pick<PlaceTab, 'page' | 'scrollY'>): void;
  /**
   * The Web View has gone: the user chose the Pane under it. Does nothing for
   * a stale token: another Tab was shown since, or the Topic changed.
   */
  leaveTab(token: number): void;
  /** The Tab a restore asks to show, handed out once. */
  takeTabToRestore(): ShownTab | null;

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
  /** A Surface said how big one cell is. See ClientSizing. */
  cellReported(cell: Extent): void;
  sheetPresented(open: boolean): void;
  lifecycleChanged(phase: LifecyclePhase): void;
  /** The Theme in use changed. Every Pane of the Session is told its new colours. */
  coloursChanged(colours: PaneColours): void;

  /** Ends it on purpose. Nothing fires afterwards. */
  close(): Promise<void>;
}

export interface AttachOptions {
  host: Host;
  destination: SessionDestination;
  /**
   * Holds a `topic` subscription on the Host's Host Server until the answer
   * is called, and hears each push as a read. See `followTopic`.
   */
  followTopic?: (hostId: string, topicId: TopicId, onRead: (read: TopicRead) => void) => () => void;
  /**
   * Unread on visit: clears the Unread of the Topic whose Session the Attach
   * shows, as the Mac does on a visit. Fire and forget: it shows nothing. See
   * `markTopicRead`.
   */
  markTopicRead?: (hostId: string, topicId: TopicId) => void;
  /** The Zoom preference this Session is opened with. */
  zoomed: boolean;
  /** The Theme's colours, for the Panes to report. Null reports nothing until coloursChanged. */
  colours?: PaneColours | null;
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
  const { openConnection, store } = options;
  /** The Host record, read again on every connect. See connect. */
  let host = options.host;
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
  let currentSessionId: string | null = null;

  /**
   * What a paste needs from the Connection in force now, before it goes into
   * the Outbox: an upload to the Host, and what the program in the Pane asked
   * for. The Composer's Send and the Key Row's ⌘v both use this.
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
      upload,
      paneState: (paneId: string) => current.paneState(paneId),
    };
  }

  // The Lane of the Draft's Pane sends the message from Send on: it keeps it
  // through a break, and the guard in tmux refuses a copy. The Draft keeps
  // the text until the Lane settles it.
  const composer = createComposer((paneId) => ({
    upload: (file, signal, progress) => openDelivery(' Draft kept.').upload(file, signal, progress),
    deliver: (text, id) => {
      say(`sending a message to ${paneId} (${text.length} characters)`);
      outbox.lane(paneId).paste(text, id);
    },
  }));

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
    typing: { kind: 'waiting', for: 'connecting' },
    step: 'connecting',
    painted: new Set(),
    paintedOnce: false,
    sessionName: options.destination.sessionName,
    topic: options.destination.topic ? { id: options.destination.topic.id, view: topicStartingFrom(options.destination.topic.seed) } : null,
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
    alternate: false,
    input: [],
    tabToRestore: null,
  };

  const outbox = createOutbox({
    now: () => clock.now(),
    ttlMs: INPUT_TTL_MS,
    onNotices: (input) => change({ input }),
    onMessage: (paneId, id, fate) => {
      say(`the message to ${paneId} is ${fate.kind}`);
      composer.settle(paneId, id, fate);
    },
    // A Surface that shows the Scrollback shows lines that are gone now.
    onCleared: (paneId) => views.get(paneId)?.jumpToLatest(),
    say: speakingAs(log, 'outbox'),
  });

  // Splits and New Windows, which change the Session and not the input of a
  // Pane. Kept across a break as the Outbox keeps keys.
  const verbs = createVerbGuard({
    say: speakingAs(log, 'verbs'),
    onRefused: (error) => change({ trouble: error }),
  });

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
    const next = { ...state, ...over };
    const typing = typingOf({ phase: next.phase, switching: pendingSwitch !== null, keyChanged: next.keyChanged });
    const retyped = !sameTyping(typing, state.typing);
    state = retyped ? { ...next, typing } : next;
    if (retyped) {
      say(`typing ${typing.kind}${typing.kind === 'waiting' ? ` for ${typing.for}` : ''}`);
      showCursors();
    }
    publish();
    notePlace();
  }

  /** Whether the view of `paneId` may draw a cursor: the active Pane, while Typing is open. */
  function cursorWanted(paneId: string, activeId = state.topology.activePane?.id): boolean {
    return state.typing.kind === 'open' && paneId === activeId;
  }

  function showCursors(): void {
    for (const [id, view] of views) view.setCursor(cursorWanted(id));
  }

  /** The state change for a Pane whose Surface was painted, or became blank. */
  function paintedChange(paneId: string, painted: boolean): Partial<AttachState> {
    if (state.painted.has(paneId) === painted) return {};
    const next = new Set(state.painted);
    if (painted) next.add(paneId);
    else next.delete(paneId);
    return painted ? { painted: next, paintedOnce: true } : { painted: next };
  }

  /**
   * The facts a subscriber would notice, written down as they change.
   *
   * Not every field: the row in sight and the Scrollback position move with
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
   * The state holds these facts for the active Pane. A view says each one when
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
    /**
     * The Client as it is now, refused once this view's Connection is over.
     *
     * Refused as a rejection, never a throw: PaneReader promises, and its
     * callers catch rejections. A throw went past them, up through a gesture
     * handler, and React Native ended the app.
     */
    const reading = async () => {
      if (stale(mine) || !client) throw new NoConnection();
      return client;
    };
    const lane = outbox.lane(paneId);

    const view = createPaneView(
      paneId,
      {
        paneState: (id) => reading().then((current) => current.paneState(id)),
        capturePane: (id) => reading().then((current) => current.capturePane(id)),
        captureScrollback: (id, start, end) => reading().then((current) => current.captureScrollback(id, start, end)),
        captureSelection: (id, start, end) => reading().then((current) => current.captureSelection(id, start, end)),
      },
      // Input is what says the phone is the one in use, so it is what takes
      // the Window back from a laptop that resized it, and its colours with it.
      {
        type: (bytes, gesture) => {
          if (sizing.reclaim() || taken) reclaimColours();
          lane.type(bytes, gesture);
        },
        press: (key) => {
          if (sizing.reclaim() || taken) reclaimColours();
          lane.press(key);
        },
      },
      {
        onScroll: (position) => paneSaid(mine, paneId, { scrolled: position }),
        onMouseTracking: (wanted) => paneSaid(mine, paneId, { mouseTracking: wanted }),
        onRowInSight: (row) => paneSaid(mine, paneId, { rowInSight: row }),
        onAlternate: (alternate) => paneSaid(mine, paneId, { alternate }),
        // A Pane that painted is a Pane that is talking to the Host again,
        // which is the honest moment to take a line of trouble down.
        onPainted: () => {
          if (!stale(mine)) change({ trouble: null, ...paintedChange(paneId, true) });
        },
        onError: (error) => {
          if (!stale(mine) && !(error instanceof NoConnection)) change({ trouble: describeError(error) });
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
    view.setCursor(cursorWanted(paneId));
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
   * paint does. And one cursor at most, in the Pane the keyboard is in —
   * remembered by each view so a repaint does not bring a second one back.
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
    for (const [id, view] of views) view.setCursor(cursorWanted(id, next.activePane?.id));
  }

  /** Disposes every view but keeps the Surfaces, which the screen still holds. */
  function releaseViews(): void {
    if (views.size > 0) say(`releasing ${views.size} views; ${onScreen.size} Surfaces kept`);
    for (const view of views.values()) view.dispose();
    views.clear();
    paneFacts.clear();
  }

  /**
   * The Attach's writes to the records: a Recent Session, the Last Place a
   * cold start goes back to, and the Topic Place. One after the other, because
   * each rewrites the whole records file and two at once would lose one of them.
   */
  let arrivalWrites = Promise.resolve();
  let sessionRevision = 0;
  type PendingSwitch = {
    destination: SessionDestination;
    confirmed: { sessionId: string; revision: number } | null;
  };
  let pendingSwitch: PendingSwitch | null = null;

  function currentSessionTarget(): string {
    return currentSessionId ?? state.sessionName;
  }

  function renameCurrentSession(name: string): void {
    if (currentSessionId === null) return;
    if (pendingSwitch?.confirmed?.sessionId === currentSessionId) {
      pendingSwitch.destination = { ...pendingSwitch.destination, sessionName: name };
    }
    change({ sessionName: name });
    if (state.phase.kind === 'connected') arrived(name, state.topic?.id ?? null);
  }

  /**
   * The Tab the Web View shows for the current Topic. A Topic change drops it
   * with no write, so the Web View that the change dismisses finds its token
   * stale, and the Topic the user left keeps its Tab.
   */
  let shownTab: ShownTab | null = null;
  let tabTokens = 0;
  /** A Topic Place to go back to once the Session is attached. See restorePlace. */
  let pendingRestore: TopicPlace | null = options.destination.restore?.topicId === options.destination.topic?.id
    ? options.destination.restore ?? null
    : null;
  let restoring = false;
  /** The Topic Place last written, so that a change which moves nothing writes nothing. */
  let writtenPlace = '';

  /**
   * Writes the Topic Place when the user moved in the Topic. Not during a
   * Session switch or a restore: the Topology then shows a Window that the
   * user is only passing through.
   */
  function notePlace(): void {
    const topic = state.topic;
    const window = state.topology.activeWindow;
    if (closed || !topic || !window || state.phase.kind !== 'connected' || pendingSwitch || pendingRestore || restoring) return;
    const place = {
      hostId: host.id,
      topicId: topic.id,
      session: state.sessionName,
      window: { id: window.id, index: window.index, name: window.name },
      pane: state.topology.activePane?.id ?? null,
      tab: shownTab?.tab ?? null,
    };
    const written = JSON.stringify(place);
    if (written === writtenPlace) return;
    writtenPlace = written;
    const at = new Date(clock.now()).toISOString();
    arrivalWrites = arrivalWrites.then(() => store.rememberTopicPlace({ ...place, at })).catch(() => {});
  }

  /**
   * Goes back to the Topic Place of a Topic just opened: its Window, then its
   * Pane. The Tab is the Terminal Screen's to show, so it waits in the state.
   */
  async function restorePlace(mine: number): Promise<void> {
    const place = pendingRestore;
    const current = client;
    if (!place || !current || stale(mine)) return;
    pendingRestore = null;
    if (state.topic?.id !== place.topicId || state.sessionName !== place.session) {
      say(`not restoring the Topic Place of ${place.topicId}: the Attach is in ${state.sessionName} now`);
      notePlace();
      return;
    }
    restoring = true;
    try {
      const window = placeWindow(state.topology.windows, place.window);
      if (window && !window.active) {
        say(`restoring the Topic Place: Window ${window.index} (${window.id})`);
        expectFocus({ kind: 'session-window-changed', window: window.id });
        await current.selectWindow(currentSessionTarget(), window.index);
        await settleAfterVerb(mine);
        if (stale(mine)) return;
      } else if (!window && place.window) {
        say(`the Topic Place's Window ${place.window.id} is gone; staying in tmux's active Window`);
      }
      if (place.pane && place.pane !== state.topology.activePane?.id &&
          state.topology.panes.some((pane) => pane.id === place.pane)) {
        say(`restoring the Topic Place: Pane ${place.pane}`);
        selectPane(place.pane);
      }
      if (place.tab && state.topic?.id === place.topicId) {
        // The Web View that the opener pushed with the Place's Tab can be up
        // already: its token stays the one that counts.
        if (shownTab?.tab.url !== place.tab.url) shownTab = { token: ++tabTokens, tab: place.tab };
        change({ tabToRestore: shownTab });
      }
    } catch (error) {
      if (!stale(mine)) change({ trouble: describeError(error) });
    } finally {
      restoring = false;
      notePlace();
    }
  }

  function arrived(sessionName: string, topicId: string | null): void {
    arrivalWrites = arrivalWrites.then(async () => {
      await store.rememberSession(host.id, sessionName);
      await store.rememberLastPlace({ hostId: host.id, session: sessionName, topicId });
    }).catch(() => {});
  }

  /** Whether the Terminal Screen came into focus before the Session was attached, so its visit waits for it. */
  let visitWaiting = false;

  /** Unread on visit for the Topic of the Session shown. A Session in no Topic sends nothing. */
  function visitTopic(): void {
    if (closed) return;
    if (state.phase.kind !== 'connected') {
      visitWaiting = true;
      return;
    }
    visitWaiting = false;
    if (state.topic) options.markTopicRead?.(host.id, state.topic.id);
  }

  function acceptDestination(destination: SessionDestination): void {
    const topic = destination.topic;
    const otherTopic = (topic?.id ?? null) !== (state.topic?.id ?? null);
    const moved = otherTopic || destination.sessionName !== state.sessionName;
    if (otherTopic) shownTab = null;
    // The Topic followed now keeps its view: its subscription pushes each change.
    const followed = topic !== null && !otherTopic && state.topic !== null && topicFeed?.id === topic.id;
    change({ ...(otherTopic ? { tabToRestore: null } : {}), sessionName: destination.sessionName, topic: topic
      ? (followed ? state.topic : { id: topic.id, view: topicStartingFrom(topic.seed ?? (state.topic?.id === topic.id ? lastTopic(state.topic.view) : null)) })
      : null });
    followTopic();
    if (state.phase.kind === 'connected') arrived(state.sessionName, state.topic?.id ?? null);
    // The Attach switched to a Session of a Topic: the Mac's visit.
    if (moved && state.phase.kind === 'connected') visitTopic();
  }

  /** How many screens show the Topic now. Its detail is followed only while one does. */
  let topicShown = 0;
  /** The `topic` subscription held now: for which Topic, and on which Connection. */
  let topicFeed: { id: TopicId; generation: number; stop: () => void } | null = null;

  /**
   * Holds a `topic` subscription while a screen shows the Topic of a
   * connected Attach, and ends it otherwise. `again` ends the one held and
   * starts a new one. Each push settles the Topic's view; a push for a
   * subscription that has ended is dropped.
   */
  function followTopic(again = false): void {
    const topic = state.topic;
    const wanted = !closed && topic !== null && topicShown > 0 && options.followTopic !== undefined &&
      state.phase.kind === 'connected';
    if (wanted && !again && topicFeed?.id === topic.id && topicFeed.generation === generation) return;
    const held = topicFeed;
    topicFeed = null;
    held?.stop();
    if (!wanted || !options.followTopic) return;
    const feed = { id: topic.id, generation, stop: () => {} };
    topicFeed = feed;
    say(`following Topic ${topic.id}`);
    change({ topic: { ...topic, view: loadingTopic(topic.view) } });
    const stop = options.followTopic(host.id, topic.id, (read) => {
      if (topicFeed !== feed || state.topic?.id !== feed.id) return;
      change({ topic: { id: feed.id, view: settledTopic(state.topic.view, read) } });
    });
    if (topicFeed === feed) feed.stop = stop;
    else stop();
  }

  function refreshTopic(): void {
    followTopic(true);
  }

  // ------------------------------------------------------------- Pane colours

  let colours: PaneColours | null = options.colours ?? null;
  /** The Panes the current Client has told tmux the current colours for. */
  let coloured = new Set<string>();

  /**
   * Whether another screen moved the focus on the Session shown, or came
   * into it, since the phone last wrote the Window's colours. The other half
   * of the mark is sizing's: a Window at a size the phone did not ask for.
   * Either makes the next key on the phone write the Window's colours again,
   * beside the size reclaim.
   */
  let taken = false;

  /**
   * The focus changes the phone asked for and tmux has not yet told of.
   * Their notifications are the phone's own, not another screen acting.
   * `undefined` matches any Pane or Window: a pick toward a direction does
   * not know where it lands.
   */
  type OwnFocus =
    | { kind: 'window-pane-changed'; window: string; pane: string | undefined }
    | { kind: 'session-window-changed'; window: string | undefined };
  let ownFocus: OwnFocus[] = [];
  /**
   * How many to keep. A select that changes nothing is told of by nothing,
   * and its entry would otherwise wait for good.
   */
  const OWN_FOCUS_KEPT = 4;

  function expectFocus(focus: OwnFocus): void {
    ownFocus.push(focus);
    if (ownFocus.length > OWN_FOCUS_KEPT) ownFocus.shift();
  }

  function windowTaken(by: string): void {
    if (!taken) say(`another screen took the Window (${by}); the next key writes the Theme's colours`);
    taken = true;
  }

  /**
   * Marks the Window taken for a focus change on the Session shown that the
   * phone did not ask for: tmux cannot say which Client made one, and only
   * the phone knows the ones it sent.
   */
  function focusChanged(event: Extract<ControlEvent, { kind: 'window-pane-changed' | 'session-window-changed' }>): void {
    if (event.kind === 'window-pane-changed') {
      // tmux tells of every Window on the server.
      if (event.window !== state.topology.activeWindow?.id) return;
    } else if (event.session !== currentSessionId) {
      return;
    }
    const pane = event.kind === 'window-pane-changed' ? event.pane : undefined;
    const own = ownFocus.findIndex((focus) => focus.kind === event.kind &&
      (focus.window ?? event.window) === event.window &&
      (focus.kind !== 'window-pane-changed' || (focus.pane ?? pane) === pane));
    if (own >= 0) {
      ownFocus.splice(own, 1);
      return;
    }
    windowTaken(`a focus change the phone did not make, ${event.kind} ${event.window}`);
  }

  /**
   * The other screens' control Clients, by name, as last read: those that
   * attached without `ignore-size`. Read at Attach and each time a Client
   * comes into a Session, so that a Client's flags are known before it
   * detaches, when tmux no longer lists it.
   */
  let screens = new Set<string>();

  function readScreens(): void {
    const mine = generation;
    const current = client;
    if (!current) return;
    background(mine, async () => {
      const read = await current.otherScreens();
      if (!stale(mine) && client === current) screens = read;
    });
  }

  /**
   * Another Client came into a Session. Into the one shown, it took the
   * Window. Either way, its flags are read now, while tmux still lists it.
   */
  function clientCameIn(event: Extract<ControlEvent, { kind: 'client-session-changed' }>): void {
    if (event.session === currentSessionId) windowTaken(`${event.client} came into the Session`);
    readScreens();
  }

  /**
   * A screen's control Client detaching leaves its Colour Report on the Panes,
   * so the phone writes its own again. A Listener detaching writes nothing:
   * nobody acted.
   */
  function clientDetached(name: string): void {
    if (!screens.delete(name)) return;
    say(`the screen ${name} detached; writing the Theme's colours to the Session again`);
    reportColours('session');
  }

  /** The first key after another screen took the Window. */
  function reclaimColours(): void {
    say('the phone is in use; writing the Theme\'s colours to the Window again');
    reportWindowColours();
  }

  /** Which Panes a colour report goes to. */
  type ColourTargets = 'untold' | 'session' | readonly string[];

  /**
   * Tells tmux the Theme's colours, without holding anything up. Safe to call
   * at any time: nothing goes on the wire while the app is in the background,
   * and a refusal is ignored.
   *
   * `untold`, for a Pane that appears: each Pane of the Session that has not
   * had the colours from this Client yet. The whole Session and not only the
   * Window on screen, because a program in another Window reads the colours
   * when it starts, not when it is shown.
   *
   * `session` or a list of Panes, where the phone's user acted: every one of
   * them, told before or not. Another Client, such as desktop Muxify, writes
   * its own colours on the same Panes, and tmux answers with the last report
   * any Client wrote, so the screen in use writes again.
   */
  function reportColours(targets: ColourTargets = 'untold'): void {
    const mine = generation;
    const current = client;
    const wanted = colours;
    const reported = coloured;
    if (!current || !wanted || suspended) return;
    // A forced write covers the Window shown, which is what a taken mark asks for.
    if (targets !== 'untold') taken = false;
    background(mine, async () => {
      const ids = typeof targets === 'string' ? await current.sessionPaneIds(currentSessionTarget()) : targets;
      if (stale(mine) || wanted !== colours || reported !== coloured) return;
      const told = targets === 'untold' ? ids.filter((id) => !reported.has(id)) : ids;
      if (told.length === 0) return;
      for (const id of told) reported.add(id);
      say(`reporting the Theme's colours to ${told.join(' ')}`);
      await current.reportPaneColours(told, wanted);
    });
  }

  /** Every Pane of the Window shown, for a pick made on the phone. */
  function reportWindowColours(): void {
    reportColours(state.topology.panes.map((pane) => pane.id));
  }

  // ------------------------------------------------------------------- Attach

  async function connect(): Promise<void> {
    const mine = generation;
    try {
      // Read again each time: a Try again after Edit Host is a try with the
      // edit in it.
      const saved = (await store.load()).hosts.find((each) => each.id === host.id);
      if (stale(mine)) return;
      if (saved) host = saved;
      say(`connecting to ${host.displayName} (${host.address}:${host.port}) for ${state.sessionName}`);
      const opened = await openConnection(host, (step) => {
        if (!stale(mine)) change({ step });
      });
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
        step: 'attaching',
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
            if (stale(mine) || state.phase.kind === 'disconnected') return;
            if (event.kind === 'session-changed') {
              const changed = currentSessionId === null
                ? event.name !== state.sessionName
                : currentSessionId !== event.session;
              currentSessionId = event.session;
              if (changed) sessionRevision += 1;
              topology?.attachedTo(currentSessionTarget());
              if (pendingSwitch?.destination.sessionName === event.name && pendingSwitch.confirmed === null) {
                acceptDestination(pendingSwitch.destination);
                pendingSwitch.confirmed = { sessionId: event.session, revision: sessionRevision };
              } else if (changed) {
                const detail = state.topic ? lastTopic(state.topic.view) : null;
                acceptDestination({ sessionName: event.name, topic: detail?.sessions.some((session) => session.name === event.name)
                  ? { id: detail.id, seed: detail } : null });
              } else if (event.name !== state.sessionName) {
                renameCurrentSession(event.name);
              }
            }
            if (event.kind === 'session-renamed') {
              refreshSessions();
              if (event.session === currentSessionId) renameCurrentSession(event.name);
            }
            if (event.kind === 'sessions-changed') refreshSessions();
            // Before the Topology moves: the Window shown is the one it names.
            if (event.kind === 'window-pane-changed' || event.kind === 'session-window-changed') focusChanged(event);
            if (event.kind === 'client-session-changed') clientCameIn(event);
            if (event.kind === 'client-detached') clientDetached(event.client);
            topology?.apply(event);
          },
          // A Connection lost while nobody is looking is the foreground check's
          // business rather than the transport-loss policy's: reconnecting
          // into a suspended app costs the Host a Connection nothing draws.
          onClosed: (detail, cause) =>
            ended(mine, reasonForClosure(cause, detail), suspended ? null : 'transport-loss'),
        },
      );
      if (stale(mine) || state.phase.kind === 'disconnected') {
        await opening.close();
        return;
      }

      control = opening;
      client = new TmuxClient(opening);
      topology = createTopologyStore(client, currentSessionTarget(), {
        onTrouble: (error) => {
          if (!stale(mine)) change({ trouble: describeError(error) });
        },
        log,
      });
      // Publishing the Topology is all that is needed: the Surfaces on screen
      // are derived from it, so a split made on the laptop, a Window switch or
      // somebody else's `select-pane` all arrive the same way.
      let windowSize: Grid | null = null;
      /**
       * The Window's shape when it was last zoomed, or last asked to be.
       *
       * tmux drops the zoom by itself whenever the Window changes under it: a
       * split, a Pane closing or a plain `select-pane`, made on the laptop or
       * by a program in a Pane. The preference says the phone wants one Pane,
       * so a Window that lost its zoom that way is zoomed again. A Window in
       * the shape it was zoomed in was unzoomed on purpose, by someone at the
       * laptop, and is left as they put it.
       */
      let zoomedShape: string | null = null;
      const keepZoom = (next: Topology) => {
        const window = next.activeWindow;
        if (!window || next.panes.length < 2) return;
        const shape = `${window.id} ${next.activePane?.id} ${next.panes.map((pane) => pane.id).join(',')}`;
        if (window.zoomed) {
          zoomedShape = shape;
          return;
        }
        if (!state.zoomed || shape === zoomedShape) return;
        zoomedShape = shape;
        say(`Window ${window.id} changed and lost its zoom; applying the Zoom preference again`);
        background(mine, () => settleAfterVerb(mine));
      };
      topology.subscribe((next) => {
        if (stale(mine)) return;
        pruneViews(next);
        keepZoom(next);
        if (next.panes.some((pane) => !coloured.has(pane.id))) reportColours();
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

      // A line of trouble is about a command on this Connection, and none has failed yet.
      change({ phase: { kind: 'connected' }, trouble: null });
      // A Connection that reached here has cleared whatever ended the last
      // one, so both automatic sources get their attempt again.
      attempted.clear();

      // Stamped on a Session that actually opened, not on one that was only
      // tapped: the Host Screen's order is a record of where you have been,
      // and a Session that refused to attach is not somewhere you have been.
      arrived(state.sessionName, state.topic?.id ?? null);
      followTopic();
      if (visitWaiting) visitTopic();

      // Size first, so the capture that follows is of a Pane the size of the
      // Surface rather than of whatever the last Client left it.
      sizing.attached();
      // Each Pane with keys from before this Connection reads its mark now,
      // and sends, holds or discards them on the answer.
      outbox.connected(client);
      // A split or New Window that the last Connection lost reads the
      // Session's Op, and is sent again only when tmux did not run it.
      verbs.connected(client);
      void client.guardsLateLines().then((guarded) => {
        if (!guarded && !stale(mine)) {
          say('this tmux is older than 3.2: a line from a lost Connection that arrives late can type its keys twice');
        }
      });
      // A phone is too narrow for side-by-side Panes, so a split Session
      // arrives with its active Pane filling the Window.
      await client.setZoom(currentSessionTarget(), state.zoomed);
      if (stale(mine)) return;
      say(`Zoom preference ${state.zoomed ? 'on' : 'off'} applied; reading the Topology`);
      await topology.refresh();
      if (stale(mine)) return;
      refreshSessions();
      reportColours();
      readScreens();
      await restorePlace(mine);
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
    // A line of trouble is about a command on this Connection, and the Cover now says why it is over.
    change({ phase: { kind: 'disconnected', reason }, trouble: null });
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
    // Before the Control Connection closes, so an answer that the close fails
    // is already an answer from a Connection that ended.
    outbox.lost();
    verbs.lost();
    const closingControl = control;
    const closingConnection = connection;
    control = null;
    client = null;
    coloured = new Set();
    ownFocus = [];
    currentSessionId = null;
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
    change({ phase, step: 'connecting' });
    followTopic();
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

  function selectPane(paneId: string): boolean {
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
    expectFocus({ kind: 'window-pane-changed', window: state.topology.activeWindow?.id ?? '', pane: paneId });
    model.activate(paneId);
    void (async () => {
      try {
        await current.selectPane(currentSessionTarget(), windowIndex, pane.index);
      } catch (error) {
        if (stale(mine)) return;
        change({ trouble: describeError(error) });
        // The move was made on a guess the Host has just refused, so the
        // guess is thrown away rather than left showing.
        await model.refresh();
      }
    })();
    reportWindowColours();
    return true;
  }

  /** Re-applies the Zoom preference and reads the Topology. Every verb ends here. */
  async function settleAfterVerb(mine: number): Promise<void> {
    const current = client;
    if (!current || stale(mine)) return;
    // Selecting a Pane drops tmux out of zoom, and moving to another Window
    // lands on one nobody has zoomed, so the preference is re-applied rather
    // than assumed to have survived.
    await current.setZoom(currentSessionTarget(), state.zoomed);
    if (stale(mine)) return;
    await topology?.refresh();
  }

  async function runSessionVerb(verb: Verb): Promise<void> {
    const mine = generation;
    if (!client) return;
    say(describeVerb(verb));
    await verbs.run(verb, currentSessionTarget());
    const current = client;
    try {
      await settleAfterVerb(mine);
    } catch (error) {
      // The verb is done. A read after it that fails is not its error, and
      // a read whose Connection ended has nothing to add to the disconnect.
      if (client === current) change({ trouble: describeError(error) });
    }
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

    refreshTopic,

    terminalFocused: visitTopic,

    showTopic(): () => void {
      topicShown += 1;
      followTopic();
      let shown = true;
      return () => {
        if (!shown) return;
        shown = false;
        topicShown -= 1;
        followTopic();
      };
    },

    async switchSession(destination: SessionDestination): Promise<void> {
      if (closed) throw new Error('This Attach has ended.');
      if (pendingSwitch) throw new Error('A Session switch is already in progress.');
      // Also for the Topic held now: Back from a Web View leaves its Tab in the
      // Place, and opening the Topic again from the Host Screen shows it again.
      const restore = destination.restore && destination.topic?.id === destination.restore.topicId
        ? destination.restore : null;
      if (destination.topic === null) {
        if (destination.sessionName === state.sessionName) return;
        const topic = state.topic && lastTopic(state.topic.view);
        if (state.topic && !topic) {
          throw new Error('The current Topic has not loaded. Retry after it loads.');
        }
        if (topic?.sessions.some((session) => session.name === destination.sessionName)) {
          destination = { ...destination, topic: { id: topic.id, seed: topic } };
        }
      }
      if (destination.sessionName === state.sessionName) {
        pendingRestore = restore;
        acceptDestination(destination);
        if (state.phase.kind === 'connected') await restorePlace(generation);
        return;
      }
      const mine = generation;
      const current = client;
      if (!current) throw new Error('The Session is not connected.');
      const observed = sessionRevision;
      const switching: PendingSwitch = { destination, confirmed: null };
      pendingSwitch = switching;
      pendingRestore = restore;
      change({});
      try {
        await current.switchSession(destination.sessionName);
        if (stale(mine) || client !== current) throw new Error('The Attach changed before the Session opened.');
        if (switching.confirmed === null) {
          if (observed !== sessionRevision) throw new Error('The Host changed Session before the requested Session opened.');
          currentSessionId = null;
          acceptDestination(switching.destination);
        }
        if (state.sessionName !== switching.destination.sessionName ||
            (switching.confirmed !== null && (switching.confirmed.revision !== sessionRevision ||
              switching.confirmed.sessionId !== currentSessionId))) {
          throw new Error('The Host changed Session before the requested Session opened.');
        }
        const completedAt = sessionRevision;
        topology?.attachedTo(currentSessionTarget());
        sizing.sessionSwitched();
        try { await settleAfterVerb(mine); }
        catch (error) { if (!stale(mine)) change({ trouble: describeError(error) }); }
        if (stale(mine) || client !== current) throw new Error('The Attach changed before the Session opened.');
        if (completedAt !== sessionRevision) {
          throw new Error('The Host changed Session before the requested Session opened.');
        }
        reportColours('session');
        await restorePlace(mine);
      } finally {
        if (restore && pendingRestore === restore) pendingRestore = null;
        if (pendingSwitch === switching) {
          pendingSwitch = null;
          change({});
        }
      }
    },

    async selectWindow(index: number): Promise<void> {
      const mine = generation;
      const current = client;
      if (!current) return;
      say(`selecting Window ${index}`);
      // A Window already shown is selected with no notification at all.
      const window = state.topology.windows.find((each) => each.index === index);
      if (!window?.active) expectFocus({ kind: 'session-window-changed', window: window?.id });
      await current.selectWindow(currentSessionTarget(), index);
      await settleAfterVerb(mine);
      // The Topology just read is the Window now shown.
      if (!stale(mine)) reportWindowColours();
    },

    selectPane,

    selectPaneToward(direction: PaneDirection): void {
      const mine = generation;
      const current = client;
      if (!current) return;
      say(`selecting the Pane ${direction}`);
      const window = state.topology.activeWindow?.id;
      if (window && state.topology.panes.length > 1) {
        expectFocus({ kind: 'window-pane-changed', window, pane: undefined });
      }
      // Settles nothing, as selectPane does not: tmux's notifications carry
      // the new active Pane.
      background(mine, () => current.selectPaneToward(currentSessionTarget(), direction));
      // Toward a neighbour, so in the Window shown.
      reportWindowColours();
    },

    split: (direction) => runSessionVerb({ kind: 'split', direction }),
    newWindow: () => runSessionVerb({ kind: 'new-window' }),

    setZoom(on: boolean): void {
      const mine = generation;
      say(`Zoom switch → ${on ? 'on' : 'off'}`);
      change({ zoomed: on });
      background(mine, async () => {
        const current = client;
        if (!current) return;
        await current.setZoom(currentSessionTarget(), on);
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
      const text =
        content.kind === 'text'
          ? content.text
          : shellQuote(await openDelivery('').upload(content.file, new AbortController().signal, () => {}));
      if (/[\r\n]/.test(text)) {
        const program = await openDelivery('').paneState(pane.id);
        if (program && !program.bracketedPaste && !(await runLines())) return;
      }
      say(`pasting into ${pane.id} (${text.length} characters)`);
      outbox.lane(pane.id).paste(text, null);
    },

    clearPane(): void {
      const pane = state.topology.activePane;
      if (!pane) return;
      say(`clearing ${pane.id}`);
      outbox.lane(pane.id).clear();
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

    async acceptHostKey(): Promise<void> {
      if (closed || !state.keyChanged) return;
      const fingerprint = state.fingerprint;
      say('the user accepted the new Host key');
      await store.rememberFingerprint(host.id, fingerprint);
      if (state.fingerprint === fingerprint) change({ keyChanged: false });
    },

    heldInput(paneId: string, action: 'send' | 'compose' | 'discard'): boolean {
      if (closed) return false;
      if (action === 'send') return outbox.release(paneId);
      const { phase } = composer.draft(paneId);
      // A Draft that uploads takes no edit, and the keys must not go where
      // the user cannot see them.
      if (action === 'compose' && phase.kind === 'uploading') return false;
      const sending = phase.kind === 'sending' ? phase.id : null;
      const keys = outbox.take(paneId);
      if (keys.length === 0) return false;
      // Taking the keys gave the message back to its Draft, which edits now.
      const at = keys.findIndex((key) => sending !== null && key.kind === 'paste' && key.message === sending);
      if (action === 'discard') {
        if (at >= 0) composer.clear(paneId);
        return true;
      }
      const text = (part: Key[]) => toDraftText(part).text;
      const { text: draft } = composer.draft(paneId);
      composer.edit(paneId, at < 0 ? draft + text(keys) : text(keys.slice(0, at)) + draft + text(keys.slice(at + 1)));
      return true;
    },

    discardedInput(paneId: string, action: 'dismiss' | 'compose'): boolean {
      if (closed) return false;
      const active = state.topology.activePane?.id;
      if (action === 'compose' && (active === undefined || !composer.move(paneId, active))) return false;
      outbox.dismiss(paneId);
      return true;
    },

    showTab(tab: PlaceTab): number {
      shownTab = { token: ++tabTokens, tab };
      say(`the Web View shows ${tab.url}`);
      // A restore's Tab waits for the Web View that shows it to take it.
      notePlace();
      return shownTab.token;
    },

    updateTab(token: number, at: Pick<PlaceTab, 'page' | 'scrollY'>): void {
      if (shownTab?.token !== token) return;
      shownTab = { token, tab: { ...shownTab.tab, ...at } };
      notePlace();
    },

    leaveTab(token: number): void {
      if (shownTab?.token !== token) return;
      say(`the Web View left ${shownTab.tab.url}`);
      shownTab = null;
      if (state.tabToRestore?.token === token) change({ tabToRestore: null });
      else notePlace();
    },

    takeTabToRestore(): ShownTab | null {
      const wanted = state.tabToRestore;
      if (wanted) change({ tabToRestore: null });
      return wanted;
    },

    view: viewFor,

    surfaceForPane(paneId: string, surface: PaneSurface | null, grid: Grid | null = null): void {
      if (closed) return;
      if (surface === null) {
        say(`Surface for ${paneId} left`);
        onScreen.delete(paneId);
        views.get(paneId)?.setSurface(null);
        change(paintedChange(paneId, false));
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
      const blank = onScreen.get(paneId)?.surface !== surface;
      onScreen.set(paneId, { surface, grid });
      if (blank) change(paintedChange(paneId, false));
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
    cellReported: (cell: Extent) => sizing.cellReported(cell),
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
        // Whatever another screen wrote meanwhile is not the phone's look.
        reportColours('session');
        return;
      }
      ended(
        generation,
        { kind: 'transport-lost', detail: 'The Connection did not survive the background' },
        'foreground',
      );
    },

    coloursChanged(next: PaneColours): void {
      if (colours?.foreground === next.foreground && colours.background === next.background) return;
      colours = next;
      coloured = new Set();
      reportColours();
    },

    async close(): Promise<void> {
      if (closed) return;
      say('closed on purpose');
      closed = true;
      const unsent = outbox.close();
      if (unsent > 0) say(`${unsent} typed keys had not reached their Pane; discarded with the Attach`);
      verbs.close();
      composer.dispose();
      generation += 1;
      followTopic();
      sizing.dispose();
      onScreen.clear();
      listeners.clear();
      state = { ...state, phase: { kind: 'closed' }, typing: { kind: 'stopped', reason: null } };
      // Awaited, so that "this Session is gone" is true by the time this
      // resolves. The holder opens the next one on the strength of it.
      await teardown();
      await arrivalWrites;
    },
  };

  // Opened, not merely constructed: an Attach with a Session name and a Host
  // is already on its way, and a caller that had to remember to start it is a
  // caller that can forget to.
  void connect();

  return attach;
}

/** The Topic Place's Window: by tmux's id, else by index and name, as Reopen makes it again. */
function placeWindow(windows: readonly Window[], wanted: TopicPlace['window']): Window | undefined {
  if (!wanted) return undefined;
  return windows.find((window) => window.id === wanted.id)
    ?? windows.find((window) => window.index === wanted.index && window.name === wanted.name);
}
