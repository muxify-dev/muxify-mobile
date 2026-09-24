import {
  attachSessionCommand,
  CAPTURE_SEPARATOR,
  capturePanesCommand,
  createSessionCommand,
  listClientsCommand,
  listPanesCommand,
  listSessionsCommand,
  listWindowsCommand,
  readStatusLineCommand,
  readWindowSizingCommand,
  redrawClientCommand,
  resizeClientCommand,
  readMouseCommand,
  readScrollStateCommand,
  selectPaneCommand,
  selectWindowCommand,
  newWindowCommand,
  setStatusLineCommand,
  setMouseCommand,
  setWindowSizingCommand,
  splitWindowCommand,
  stopScrollingCommand,
  switchSessionCommand,
  zoomPaneCommand,
} from './commands';
import { parseWindowLayout } from './layout';

import type { TmuxExecResult, TmuxShell, TmuxShellEvents, TmuxTransport } from './transport';

/** A tmux Session on a Host. */
export interface Session {
  name: string;
  /** How many Windows it holds, which is all a picker needs to describe it. */
  windowCount: number;
  /**
   * Whether any Client is on it — anyone's, not just Muxify's. A Session
   * someone else is watching is one that Attaching will shrink, because the
   * Window follows the smallest Client.
   */
  attached: boolean;
}

/**
 * How far back through its history a Pane is being viewed.
 *
 * `back` is zero at the live bottom. `history` is how many lines tmux is
 * holding, which is what `history-limit` allows and not what has been written
 * — scrolling cannot reach further than this.
 */
export interface ScrollPosition {
  back: number;
  history: number;
}

/**
 * What a scroll gesture should be turned into for the Pane as it stands.
 *
 * - `history`: a shell at a prompt. A wheel event puts tmux into copy-mode and
 *   moves through the scrollback.
 * - `application`: a full-screen application that asked for the mouse — Claude
 *   Code, htop, vim with `mouse=a`. The wheel is handed to it and it scrolls
 *   itself.
 * - `keys`: a full-screen application that did not ask for the mouse — `less`,
 *   `man`. A wheel event reaches it and means nothing, so it gets cursor keys
 *   instead. tmux used to do this itself until `alternate-scroll` was dropped.
 */
export type ScrollRoute = 'history' | 'application' | 'keys';

export interface ScrollState {
  position: ScrollPosition | undefined;
  route: ScrollRoute;
}

/** A tmux Window inside a Session. */
export interface Window {
  index: number;
  name: string;
  active: boolean;
  /** How many Panes it holds, which is what makes a preview worth showing. */
  paneCount: number;
  /** Whether its active Pane is zoomed to fill the Window. */
  zoomed: boolean;
  /** What the active Pane is running, as tmux reports it. */
  command: string;
}

/** A tmux Pane inside a Window. */
export interface Pane {
  index: number;
  /** tmux's own handle for the Pane (`%3` reads as 3), which the layout uses. */
  id: number;
  /** The command currently running in the Pane, as tmux reports it. */
  command: string;
  active: boolean;
  /**
   * The Pane's working directory. What a Pane is doing is mostly where it is,
   * and it is the only field that differs between Panes of the same Session —
   * `#{pane_title}` is the Host's name on every one of them.
   */
  path: string;
  /**
   * Where the Pane sits in the Window's grid, in cells, as the Window's layout
   * has it — which is where it will be once zoom is turned off, not where a
   * zoomed Pane is currently painted. Zero throughout for a Pane the layout
   * does not mention, which nothing should try to draw. See parseWindowLayout.
   */
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The Surface's cell grid, used to size the remote terminal. */
export interface Grid {
  cols: number;
  rows: number;
}

export class TmuxError extends Error {
  constructor(
    message: string,
    readonly exitCode: number,
  ) {
    super(message);
    this.name = 'TmuxError';
  }
}

export interface TmuxClientOptions {
  /** Absolute path to tmux, for Hosts where it is not on a non-interactive PATH. */
  tmuxExecutablePath?: string;
}

/**
 * Speaks tmux over a transport.
 *
 * Reads Topology on demand through Control Commands rather than holding a live
 * model of it — see ADR 0001 for why this is not tmux control mode. Every
 * picker re-reads, so nothing is ever stale.
 */
export class TmuxClient {
  private readonly tmuxExecutablePath?: string;

  constructor(
    private readonly transport: TmuxTransport,
    options: TmuxClientOptions = {},
  ) {
    this.tmuxExecutablePath = options.tmuxExecutablePath;
  }

  /**
   * The Sessions running on the Host.
   *
   * A Host with no tmux server is an empty list, not a failure — tmux exits
   * non-zero for that, and treating it as an error would make every fresh
   * machine look broken.
   */
  async listSessions(): Promise<Session[]> {
    const result = await this.transport.exec(listSessionsCommand(this.tmuxExecutablePath));

    if (result.exitCode !== 0) {
      if (meansNoServer(result)) return [];
      throw failure('list Sessions', result);
    }

    return nonEmptyLines(result.stdout).flatMap((line) => {
      const fields = splitFields(line, 3);
      if (!fields) return [];
      const [windowCount, name, attached] = fields;
      return [{ name, windowCount: countOf(windowCount), attached: attached !== '0' }];
    });
  }

  /**
   * Creates a Session on the Host and leaves it running.
   *
   * Unlike a listing, a failure is reported: the name may already be taken,
   * and silently handing back the Session that owns it would be worse than an
   * error. See ADR 0005.
   */
  async createSession(name: string): Promise<void> {
    await this.run('create Session', createSessionCommand(name, this.tmuxExecutablePath));
  }

  /** The Windows of a Session. A Session that has vanished reads as none. */
  async listWindows(sessionName: string): Promise<Window[]> {
    const result = await this.transport.exec(
      listWindowsCommand(sessionName, this.tmuxExecutablePath),
    );

    if (result.exitCode !== 0) {
      if (meansNoServer(result) || meansMissingTarget(result)) return [];
      throw failure('list Windows', result);
    }

    return nonEmptyLines(result.stdout).flatMap((line) => {
      const fields = splitFields(line, 6);
      if (!fields) return [];
      const [index, name, active, paneCount, zoomed, command] = fields;
      const parsed = Number(index);
      if (!Number.isInteger(parsed)) return [];
      return [
        {
          index: parsed,
          name,
          active: active === '1',
          paneCount: countOf(paneCount),
          zoomed: zoomed === '1',
          command,
        },
      ];
    });
  }

  /** The Panes of one Window. A Window that has vanished reads as none. */
  async listPanes(sessionName: string, windowIndex: number): Promise<Pane[]> {
    const result = await this.transport.exec(
      listPanesCommand(sessionName, windowIndex, this.tmuxExecutablePath),
    );

    if (result.exitCode !== 0) {
      if (meansNoServer(result) || meansMissingTarget(result)) return [];
      throw failure('list Panes', result);
    }

    const nowhere = { left: 0, top: 0, width: 0, height: 0 };
    // Every line carries the same layout, so the first one that parses settles
    // where all of them are. See listPanesCommand for why it is asked for.
    let layout = new Map<number, typeof nowhere>();

    return nonEmptyLines(result.stdout).flatMap((line) => {
      const fields = splitFields(line, 6);
      if (!fields) return [];
      const [index, id, command, active, path, windowLayout] = fields;
      const parsed = Number(index);
      if (!Number.isInteger(parsed)) return [];
      if (layout.size === 0) layout = parseWindowLayout(windowLayout);
      const paneId = countOf(id.replace('%', ''));
      return [
        {
          index: parsed,
          id: paneId,
          command,
          active: active === '1',
          path,
          ...(layout.get(paneId) ?? nowhere),
        },
      ];
    });
  }

  /**
   * Moves the attached client to another Window.
   *
   * Unlike a listing, a failure here is reported: the user asked for this
   * explicitly and silently doing nothing would be worse than an error.
   */
  async selectWindow(sessionName: string, windowIndex: number): Promise<void> {
    await this.run(
      'select Window',
      selectWindowCommand(sessionName, windowIndex, this.tmuxExecutablePath),
    );
  }

  /**
   * Where the active Pane is in its history, for the label.
   *
   * Undefined whenever there is nothing to say: a Pane that is not in
   * copy-mode, a Session that has gone, or a full-screen application doing its
   * own scrolling — none of which has a position tmux can report.
   */
  async readScrollState(sessionName: string): Promise<ScrollState> {
    const unknown: ScrollState = { position: undefined, route: 'history' };
    let result: TmuxExecResult;
    try {
      result = await this.transport.exec(
        readScrollStateCommand(sessionName, this.tmuxExecutablePath),
      );
    } catch {
      return unknown;
    }
    if (result.exitCode !== 0) return unknown;

    const [line] = nonEmptyLines(result.stdout);
    if (line === undefined) return unknown;
    const fields = splitFields(line, 5);
    if (!fields) return unknown;
    const [inMode, back, history, alternate, wantsMouse] = fields;

    const route: ScrollRoute =
      alternate !== '1' ? 'history' : wantsMouse === '1' ? 'application' : 'keys';
    const position =
      inMode === '1' && back !== '' ? { back: countOf(back), history: countOf(history) } : undefined;
    return { position, route };
  }

  /** Puts the active Pane back at the live bottom. Best effort. */
  async stopScrolling(sessionName: string): Promise<void> {
    try {
      await this.transport.exec(stopScrollingCommand(sessionName, this.tmuxExecutablePath));
    } catch {
      // Nothing to do: the Pane is either already at the bottom or gone.
    }
  }

  /** Moves the attached client to another Pane. */
  async selectPane(sessionName: string, windowIndex: number, paneIndex: number): Promise<void> {
    await this.run(
      'select Pane',
      selectPaneCommand(sessionName, windowIndex, paneIndex, this.tmuxExecutablePath),
    );
  }

  /**
   * Points the attached client at a different Session.
   *
   * The Shell Channel stays open throughout; the client follows and the Surface
   * redraws. This is why switching Session does not cost a reconnect.
   */
  async switchSession(sessionName: string): Promise<void> {
    await this.run(
      'switch Session',
      switchSessionCommand(sessionName, this.tmuxExecutablePath),
    );
  }

  /**
   * The tty of the Session's most recently attached Client.
   *
   * Called straight after an Attach, when the newest Client is ours. Other
   * Clients of the same Session are none of Muxify's business, so a redraw has
   * to know which one to aim at. Undefined when tmux will not say, which the
   * caller should treat as "redraw whichever Client tmux likes".
   */
  async newestClient(sessionName: string): Promise<string | undefined> {
    let result: TmuxExecResult;
    try {
      result = await this.transport.exec(listClientsCommand(sessionName, this.tmuxExecutablePath));
    } catch {
      return undefined;
    }
    if (result.exitCode !== 0) return undefined;

    let newest: { created: number; tty: string } | undefined;
    for (const line of nonEmptyLines(result.stdout)) {
      const fields = splitFields(line, 2);
      if (!fields) continue;
      const [created, tty] = fields;
      const at = Number(created);
      if (!Number.isFinite(at) || tty === '') continue;
      if (!newest || at >= newest.created) newest = { created: at, tty };
    }
    return newest?.tty;
  }

  /**
   * Makes a Client repaint everything, clearing what a resize left behind.
   *
   * See redrawClientCommand for why the debris exists. Best effort: a dirty
   * Surface is ugly, not broken, and one more failure path here would be worse.
   */
  async redrawClient(clientTty?: string): Promise<void> {
    try {
      await this.transport.exec(redrawClientCommand(clientTty, this.tmuxExecutablePath));
    } catch {
      // Best effort.
    }
  }

  /**
   * Sets the size of the Client's pty, from the Host side.
   *
   * The SSH library will not send a window-change, so this does the same job
   * from the other end — see resizeClientCommand. Best effort: a Client whose
   * size is briefly wrong is a cosmetic problem, and throwing here would take
   * down a Session that is otherwise working.
   */
  /**
   * Sets the Client's size from the Host side.
   *
   * Reports a failure rather than swallowing it, because the scheduler must not
   * record a size it never sent — that was enough, on its own, to disable every
   * later resize of a Connection.
   *
   * It cannot confirm the size took. tmux's `#{client_width}` reports the size
   * from one change ago, at any delay: with the pty at 13 it says 23, and
   * setting the pty to 15 makes it say 13. So there is nothing here to read
   * back and compare against, and an assertion built on that field is testing
   * tmux's bookkeeping rather than the Surface.
   */
  async setClientSize(clientTty: string, grid: Grid): Promise<void> {
    const result = await this.transport.exec(
      resizeClientCommand(clientTty, grid.cols, grid.rows, this.tmuxExecutablePath),
    );
    if (result.exitCode !== 0) throw failure('resize the Client', result);
  }

  /** Reads whether tmux is reading mouse events, so it can be restored. */
  async readMouse(sessionName: string): Promise<string | undefined> {
    try {
      const result = await this.transport.exec(
        readMouseCommand(sessionName, this.tmuxExecutablePath),
      );
      if (result.exitCode !== 0) return undefined;
      const [line] = nonEmptyLines(result.stdout);
      return line;
    } catch {
      return undefined;
    }
  }

  /** Turns tmux's mouse reading on or off for a Session. */
  async setMouse(sessionName: string, value: string): Promise<void> {
    await this.run('set mouse', setMouseCommand(sessionName, value, this.tmuxExecutablePath));
  }

  /**
   * Reads the Session's current `status` setting, so it can be restored.
   * Returns `undefined` when tmux will not say, in which case leave it alone.
   */
  async readStatusLine(sessionName: string): Promise<string | undefined> {
    try {
      const result = await this.transport.exec(
        readStatusLineCommand(sessionName, this.tmuxExecutablePath),
      );
      if (result.exitCode !== 0) return undefined;
      const value = result.stdout.trim();
      return value === '' ? undefined : value;
    } catch {
      return undefined;
    }
  }

  /**
   * Shows or hides the Session's status line.
   *
   * Hidden while Muxify is attached because the Dock already shows the Session,
   * Window and Pane, and a phone has no rows to spare. Best effort: a Session
   * that keeps its status line is a cosmetic problem, not a broken one.
   */
  async setStatusLine(sessionName: string, value: string): Promise<void> {
    try {
      await this.transport.exec(
        setStatusLineCommand(sessionName, value, this.tmuxExecutablePath),
      );
    } catch {
      // Best effort.
    }
  }

  /**
   * Reads how the Session sizes its Windows, so it can be restored.
   * Returns `undefined` when tmux will not say, in which case leave it alone.
   */
  async readWindowSizing(sessionName: string): Promise<string | undefined> {
    try {
      const result = await this.transport.exec(
        readWindowSizingCommand(sessionName, this.tmuxExecutablePath),
      );
      if (result.exitCode !== 0) return undefined;
      const value = result.stdout.trim();
      return value === '' ? undefined : value;
    } catch {
      return undefined;
    }
  }

  /**
   * Sets how the Session sizes its Windows — `smallest` while Muxify is
   * attached, so the Window can never outgrow the Surface and be padded. See
   * readWindowSizingCommand. Best effort: getting this wrong means dots, not a
   * broken Session.
   */
  async setWindowSizing(sessionName: string, value: string): Promise<void> {
    try {
      await this.transport.exec(
        setWindowSizingCommand(sessionName, value, this.tmuxExecutablePath),
      );
    } catch {
      // Best effort.
    }
  }

  /**
   * What each of these Panes is showing right now, keyed by target.
   *
   * One round trip for all of them; see capturePanesCommand. A Pane that fails
   * to capture is simply absent, because a preview is worth exactly nothing
   * when it costs a working picker.
   */
  async capturePanes(targets: string[]): Promise<Map<string, string[]>> {
    const previews = new Map<string, string[]>();
    if (targets.length === 0) return previews;

    let result: TmuxExecResult;
    try {
      result = await this.transport.exec(capturePanesCommand(targets, this.tmuxExecutablePath));
    } catch {
      return previews;
    }
    if (result.exitCode !== 0) return previews;

    const captures = result.stdout.split(CAPTURE_SEPARATOR);
    targets.forEach((target, index) => {
      const capture = captures[index];
      if (capture === undefined) return;
      previews.set(target, capture.split('\n').filter((line, at, all) =>
        // Keep interior blank lines, drop the ones the separator leaves behind.
        line.trim() !== '' || (at > 0 && at < all.length - 1),
      ));
    });
    return previews;
  }

  /** Toggles zoom on the Session's active Pane. */
  async setZoom(sessionName: string, zoomed: boolean): Promise<void> {
    const windows = await this.listWindows(sessionName);
    const active = windows.find((window) => window.active);
    if (!active || active.zoomed === zoomed) return;
    // Zooming a Window with one Pane does nothing in tmux, and asking costs a
    // round trip nobody sees the benefit of.
    if (active.paneCount < 2) return;
    await this.run('zoom Pane', zoomPaneCommand(sessionName, this.tmuxExecutablePath));
  }

  /** Splits the Session's active Pane. */
  async splitWindow(sessionName: string, direction: 'right' | 'down'): Promise<void> {
    await this.run(
      'split Window',
      splitWindowCommand(sessionName, direction, this.tmuxExecutablePath),
    );
  }

  /** Adds a Window to the Session, after the current one. */
  async newWindow(sessionName: string): Promise<void> {
    await this.run('add a Window', newWindowCommand(sessionName, this.tmuxExecutablePath));
  }

  /** Opens the Shell Channel and Attaches it to an existing Session. */
  attach(sessionName: string, grid: Grid, events: TmuxShellEvents): Promise<TmuxShell> {
    return this.transport.openShell(
      {
        term: 'xterm-256color',
        cols: grid.cols,
        rows: grid.rows,
        command: attachSessionCommand(sessionName, this.tmuxExecutablePath),
      },
      events,
    );
  }

  private async run(what: string, command: string): Promise<void> {
    const result = await this.transport.exec(command);
    if (result.exitCode !== 0) {
      throw failure(what, result);
    }
  }
}

/** A tmux count or coordinate, or 0 when it is not a number. */
function countOf(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nonEmptyLines(stdout: string): string[] {
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** Splits a tab-separated record, or `null` when it does not have enough fields. */
function splitFields(line: string, count: number): string[] | null {
  const fields = line.split('\t');
  if (fields.length < count) return null;
  // Rejoin any overflow into the middle field so a name containing a tab-like
  // sequence cannot shift the trailing flag.
  if (fields.length > count) {
    const head = fields.slice(0, count - 2);
    const tail = fields[fields.length - 1];
    const middle = fields.slice(count - 2, fields.length - 1).join('\t');
    return [...head, middle, tail];
  }
  return fields;
}

/** tmux's way of saying there is nothing running, which is not an error here. */
function meansNoServer(result: TmuxExecResult): boolean {
  const text = `${result.stderr} ${result.stdout}`.toLowerCase();
  return text.includes('no server running') || text.includes('error connecting to');
}

/** tmux's way of saying the Session or Window is gone. */
function meansMissingTarget(result: TmuxExecResult): boolean {
  return `${result.stderr} ${result.stdout}`.toLowerCase().includes("can't find");
}

function failure(what: string, result: TmuxExecResult): TmuxError {
  const detail = result.stderr.trim() || result.stdout.trim() || `exit ${result.exitCode}`;
  return new TmuxError(`Could not ${what}: ${detail}`, result.exitCode);
}
