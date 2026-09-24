import {
  attachSessionCommand,
  CAPTURE_SEPARATOR,
  capturePanesCommand,
  listClientsCommand,
  listPanesCommand,
  listSessionsCommand,
  listWindowsCommand,
  manualWindowSizeCommand,
  readStatusLineCommand,
  redrawClientCommand,
  resizeWindowCommand,
  selectPaneCommand,
  selectWindowCommand,
  newWindowCommand,
  setStatusLineCommand,
  splitWindowCommand,
  switchSessionCommand,
  zoomPaneCommand,
} from './commands';
import type { TmuxExecResult, TmuxShell, TmuxShellEvents, TmuxTransport } from './transport';

/** A tmux Session on a Host. */
export interface Session {
  name: string;
  /** How many Windows it holds, which is all a picker needs to describe it. */
  windowCount: number;
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
  /** The command currently running in the Pane, as tmux reports it. */
  command: string;
  active: boolean;
  /** The Pane's title, which is usually the Host's name. */
  title: string;
  /** Where the Pane sits in the Window's grid, in cells. */
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
  /** Sessions already switched to manual window sizing. */
  private readonly sizedByHand = new Set<string>();

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
      const fields = splitFields(line, 2);
      if (!fields) return [];
      const [name, windowCount] = fields;
      return [{ name, windowCount: countOf(windowCount) }];
    });
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

    return nonEmptyLines(result.stdout).flatMap((line) => {
      const fields = splitFields(line, 8);
      if (!fields) return [];
      const [index, command, active, title, left, top, width, height] = fields;
      const parsed = Number(index);
      if (!Number.isInteger(parsed)) return [];
      return [
        {
          index: parsed,
          command,
          active: active === '1',
          title,
          left: countOf(left),
          top: countOf(top),
          width: countOf(width),
          height: countOf(height),
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
   * Forces the Session's Window to an explicit size.
   *
   * The Shell Channel's own resize is the natural way to do this, but the SSH
   * library does not reliably send the window-change request, so the remote is
   * left at a stale size and tmux draws rows the Surface never shows. Going
   * through a Control Command uses the exec channel, which is reliable.
   *
   * Switches the Session to manual window sizing first, without which tmux
   * sizes the Window from its attached clients and ignores the resize. That
   * only has to happen once per Session, and it is worth remembering: while a
   * resize is in flight the Surface is showing rows tmux has padded, so a
   * needless extra round trip is time spent looking at dots.
   *
   * Failures are swallowed: a wrong size is a bad experience, but an exception
   * here would take down a Session that is otherwise working.
   */
  async setWindowSize(sessionName: string, grid: Grid): Promise<void> {
    try {
      if (!this.sizedByHand.has(sessionName)) {
        const result = await this.transport.exec(
          manualWindowSizeCommand(sessionName, this.tmuxExecutablePath),
        );
        // Only remember it when tmux accepted it, so a transient failure does
        // not leave the Session stuck ignoring every later resize.
        if (result.exitCode === 0) this.sizedByHand.add(sessionName);
      }
      await this.transport.exec(
        resizeWindowCommand(sessionName, grid.cols, grid.rows, this.tmuxExecutablePath),
      );
    } catch {
      // Best effort; the Session stays usable at its previous size.
    }
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
