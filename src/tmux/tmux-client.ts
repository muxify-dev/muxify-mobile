import {
  capturePaneCommand,
  capturePaneTextCommand,
  captureSelectionCommands,
  clearHistoryCommand,
  captureScrollbackCommand,
  capturePanesCommand,
  createSessionCommand,
  listPanesCommand,
  listSessionsCommand,
  listWindowsCommand,
  newWindowCommand,
  paneStateCommand,
  claimWindowCommand,
  resizeClientCommand,
  selectPaneCommand,
  selectWindowCommand,
  sendKeyCommand,
  sendKeysCommand,
  splitWindowCommand,
  switchSessionCommand,
  zoomPaneCommand,
} from './commands';
import type { CommandReply, CommandRunner } from './control-connection';
import { paneNumber, parseWindowLayout, type PaneRect } from './layout';
import { selectionRows, type SelectionRow } from './selection-rows';
import { TmuxError } from './tmux-error';

export { TmuxError };

/** A tmux Session on a Host. */
export interface Session {
  name: string;
  /** How many Windows it holds, which is all a picker needs to describe it. */
  windowCount: number;
}

/** A tmux Window inside a Session. */
export interface Window {
  /** tmux's own handle, as tmux writes it: `@2`. What notifications name. */
  id: string;
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
  /** tmux's own handle for the Pane, as tmux writes it: `%3`. */
  id: string;
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

/**
 * What a Pane is doing, as far as anything outside it can tell.
 *
 * Read on Attach and on every switch, because it is what a resync needs and
 * what decides how a scroll gesture behaves. `alternate` is the whole of that
 * decision: a full-screen application is handed the wheel and scrolls itself,
 * and a shell at a prompt has its Scrollback painted from a capture.
 */
export interface PaneState {
  cursorColumn: number;
  cursorRow: number;
  alternate: boolean;
  /**
   * How many lines of Scrollback tmux is holding above the screen, bounded by
   * its `history-limit`. tmux's own name for it is `history_size`.
   */
  scrollbackLines: number;
  width: number;
  height: number;
  /**
   * Whether the application in the Pane asked for mouse events. A full-screen
   * one that did will act on a wheel event; one that did not will ignore it
   * entirely, and has to be sent cursor keys instead.
   */
  wantsMouse: boolean;
  /**
   * Whether the application in the Pane shows the terminal's cursor. Claude
   * Code, Codex and most full-screen programs hide it (`ESC[?25l`) once, at
   * their start, and draw a cursor of their own.
   */
  cursorShown: boolean;
  /**
   * Whether the program in the Pane asked for bracketed paste, so that a
   * paste reaches it as one piece. `paste-buffer -p` brackets a paste only
   * for a program that asked; for any other, each line break of the paste is
   * an Enter. Measured on tmux 3.8: true for bash 5, false for `cat` and for
   * a bash with `enable-bracketed-paste off`. False where tmux cannot say.
   */
  bracketedPaste: boolean;
}

/** One range of a Pane, captured for a Selection. */
export interface SelectionCapture {
  /** The rows as `capture-pane -e -N` gave them, to paint. */
  lines: Uint8Array[];
  /** The line of the first row, counted from the first line of the Scrollback. */
  top: number;
  /** The same rows as text, cut to a Surface this many columns wide. */
  rows(cols: number): SelectionRow[];
}

/** The Surface's cell grid, used to size the Client. */
export interface Grid {
  cols: number;
  rows: number;
}

/**
 * Whether two grids are the same shape.
 *
 * Beside the type rather than in each of the three modules that asks: the
 * sizing module, the scheduler inside it and the Pane view all decide whether
 * something is worth acting on by exactly this comparison, and three copies of
 * it is three places for one of them to start comparing by reference.
 */
export function sameGrid(a: Grid | null | undefined, b: Grid | null | undefined): boolean {
  if (!a || !b) return false;
  return a.cols === b.cols && a.rows === b.rows;
}

/**
 * Speaks tmux over a CommandRunner.
 *
 * The runner is the Control Connection once a Session is open, and a one-shot
 * exec runner for the two things that happen before there is one. Neither is
 * this class's business: it builds commands and reads replies.
 *
 * Nothing here reads, sets or restores a Session option. That is not an
 * omission — it is what the migration to control mode was for. See ADR 0006.
 */
export class TmuxClient {
  constructor(private readonly runner: CommandRunner) {}

  /**
   * The Sessions running on the Host.
   *
   * A Host with no tmux server is an empty list, not a failure — tmux exits
   * non-zero for that, and treating it as an error would make every fresh
   * machine look broken.
   */
  async listSessions(): Promise<Session[]> {
    const reply = await this.runner.run(listSessionsCommand());

    if (!reply.ok) {
      if (meansNoServer(reply)) return [];
      throw failure('list Sessions', reply);
    }

    return reply.text.flatMap((line) => {
      const fields = splitFields(line, 2);
      if (!fields) return [];
      const [name, windowCount] = fields;
      return [{ name, windowCount: countOf(windowCount) }];
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
    await this.mustRun('create Session', createSessionCommand(name));
  }

  /** The Windows of a Session. A Session that has vanished reads as none. */
  async listWindows(sessionName: string): Promise<Window[]> {
    const reply = await this.runner.run(listWindowsCommand(sessionName));

    if (!reply.ok) {
      if (meansNoServer(reply) || meansMissingTarget(reply)) return [];
      throw failure('list Windows', reply);
    }

    return reply.text.flatMap((line) => {
      const fields = splitFields(line, 7);
      if (!fields) return [];
      const [id, index, active, paneCount, zoomed, name, command] = fields;
      const parsed = Number(index);
      if (!Number.isInteger(parsed)) return [];
      return [
        {
          id,
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
    const reply = await this.runner.run(listPanesCommand(sessionName, windowIndex));

    if (!reply.ok) {
      if (meansNoServer(reply) || meansMissingTarget(reply)) return [];
      throw failure('list Panes', reply);
    }

    const nowhere: PaneRect = { left: 0, top: 0, width: 0, height: 0 };
    // Every line carries the same layout, so the first one that parses settles
    // where all of them are. See listPanesCommand for why it is asked for.
    let layout = new Map<number, PaneRect>();

    return reply.text.flatMap((line) => {
      const fields = splitFields(line, 6);
      if (!fields) return [];
      const [index, id, command, active, path, windowLayout] = fields;
      const parsed = Number(index);
      if (!Number.isInteger(parsed)) return [];
      if (layout.size === 0) layout = parseWindowLayout(windowLayout);
      return [
        {
          index: parsed,
          id,
          command,
          active: active === '1',
          path,
          ...(layout.get(paneNumber(id)) ?? nowhere),
        },
      ];
    });
  }

  /**
   * Moves the Client to another Window.
   *
   * Unlike a listing, a failure here is reported: the user asked for this
   * explicitly and silently doing nothing would be worse than an error.
   */
  async selectWindow(sessionName: string, windowIndex: number): Promise<void> {
    await this.mustRun('select Window', selectWindowCommand(sessionName, windowIndex));
  }

  /** Moves the Client to another Pane. */
  async selectPane(sessionName: string, windowIndex: number, paneIndex: number): Promise<void> {
    await this.mustRun('select Pane', selectPaneCommand(sessionName, windowIndex, paneIndex));
  }

  /**
   * Points the Client at a different Session.
   *
   * The Control Connection stays open throughout: tmux answers with
   * `%session-changed`, the Topology is read again, and the Surface is
   * resynced from the new Session's Pane. This is why switching Session does
   * not cost a reconnect.
   */
  async switchSession(sessionName: string): Promise<void> {
    await this.mustRun('switch Session', switchSessionCommand(sessionName));
  }

  /**
   * Tells tmux how big this Client is.
   *
   * The only size Muxify sets, and it sets no Session option to do it. Under
   * tmux's default `window-size latest` the Window follows this Client once it
   * is the latest, and goes back when the Client leaves — ordinary tmux
   * sizing, with nothing to restore. See claimWindowCommand.
   */
  async resizeClient(grid: Grid): Promise<void> {
    // Written together: tmux runs them in the order they arrive, and nothing
    // else gets between the claim and the size it is for.
    await Promise.all([
      this.mustRun('claim the Window', claimWindowCommand()),
      this.mustRun('resize the Client', resizeClientCommand(grid.cols, grid.rows)),
    ]);
  }

  /**
   * Types bytes into a Pane.
   *
   * Every keystroke, every wheel notch on the alternate screen, every escape
   * sequence. `send-keys -H` carries them exactly, and because they go into
   * the Pane rather than through tmux's key table, tmux's prefix never fires.
   */
  async sendKeys(paneId: string, bytes: Uint8Array): Promise<void> {
    if (bytes.length === 0) return;
    await this.mustRun('send input', sendKeysCommand(paneId, bytes));
  }

  /** tmux supplies bracketed paste only when the destination application asks. */
  async preparePaste(text: string, name: string, check: () => void): Promise<{
    paste(paneId: string): Promise<void>;
    dispose(): Promise<void>;
  }> {
    // Small commands stay below tmux's command-line limit. Iterating code points
    // also keeps surrogate pairs together at the chunk boundary.
    const points = Array.from(text);
    const dispose = async () => { await this.runner.run(['delete-buffer', '-b', name]); };
    try {
      for (let offset = 0; offset < points.length; offset += 2048) {
        check();
        await this.mustRun('prepare paste', [
          'set-buffer', '-b', name, ...(offset ? ['-a'] : []), '--',
          points.slice(offset, offset + 2048).join(''),
        ]);
      }
    } catch (error) {
      await dispose().catch(() => {});
      throw error;
    }
    return {
      paste: (paneId) => this.mustRun('paste message', ['paste-buffer', '-p', '-r', '-d', '-b', name, '-t', paneId]),
      dispose,
    };
  }

  /**
   * Sends one named key into a Pane: `Up`, `Escape`, `C-c`, `M-b`.
   *
   * The Key Row's path. Named rather than the bytes for it, because which
   * bytes are right depends on what the Pane is running and tmux is the only
   * one here that knows — see sendKeyCommand.
   */
  async sendKey(paneId: string, key: string): Promise<void> {
    await this.mustRun('send key', sendKeyCommand(paneId, key));
  }

  /**
   * What is already on a Pane's screen, as bytes ready for the Surface.
   *
   * The first half of a resync: `%output` carries only what happens next, so
   * without this an Attach shows an empty screen until something moves.
   */
  async capturePane(paneId: string): Promise<Uint8Array[]> {
    const reply = await this.runner.run(capturePaneCommand(paneId));
    return reply.ok ? reply.lines : [];
  }

  /**
   * A range of a Pane's Scrollback, as bytes.
   *
   * Line numbers are tmux's: negative is above the top of the screen. This is
   * how the Scrollback is read now that tmux's copy-mode is not involved — see
   * ticket 06.
   */
  async captureScrollback(
    paneId: string,
    startLine: number,
    endLine: number,
  ): Promise<Uint8Array[]> {
    const reply = await this.runner.run(captureScrollbackCommand(paneId, startLine, endLine));
    return reply.ok ? reply.lines : [];
  }

  /**
   * A range of a Pane for a Selection: the rows to paint, and their text.
   *
   * A failure is reported: the user pressed on this text to select it.
   */
  async captureSelection(
    paneId: string,
    startLine: number,
    endLine: number,
  ): Promise<SelectionCapture> {
    const replies = await this.runner.runAll(captureSelectionCommands(paneId, startLine, endLine));
    const [history, painted, joined] = replies;
    const refused = replies.find((reply) => !reply.ok);
    if (!history || !painted || !joined || refused) {
      throw failure('read the Pane text', refused ?? { ok: false, lines: [], text: [] });
    }
    const top = countOf(history.text[0] ?? '') + Math.floor(startLine);
    return {
      lines: painted.lines,
      top,
      rows: (cols) => selectionRows(painted.text, joined.text, top, cols),
    };
  }

  /**
   * Where the cursor is, what kind of screen the Pane is showing, and how much
   * Scrollback is behind it.
   *
   * Undefined when tmux will not say, which is a Pane that has gone. The
   * caller should leave things as they are rather than guess.
   */
  async paneState(paneId: string): Promise<PaneState | undefined> {
    const reply = await this.runner.run(paneStateCommand(paneId));
    if (!reply.ok) return undefined;
    const fields = splitFields(reply.text[0] ?? '', 9);
    if (!fields) return undefined;
    const [column, row, alternate, scrollback, width, height, wantsMouse, cursorShown, bracketedPaste] = fields;
    return {
      cursorColumn: countOf(column),
      cursorRow: countOf(row),
      alternate: alternate === '1',
      scrollbackLines: countOf(scrollback),
      width: countOf(width),
      height: countOf(height),
      wantsMouse: wantsMouse === '1',
      cursorShown: cursorShown !== '0',
      bracketedPaste: bracketedPaste === '1',
    };
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

    let replies: CommandReply[];
    try {
      replies = await this.runner.runAll(capturePanesCommand(targets));
    } catch {
      return previews;
    }

    targets.forEach((target, index) => {
      const reply = replies[index];
      if (reply?.ok) previews.set(target, reply.text);
    });
    return previews;
  }

  /**
   * What a Pane shows, as text for the clipboard: wrapped lines joined, and
   * the empty lines under the prompt left off.
   *
   * A failure is reported, unlike a preview: the user asked for this text.
   */
  async capturePaneText(paneId: string): Promise<string> {
    const reply = await this.runner.run(capturePaneTextCommand(paneId));
    if (!reply.ok) throw failure('copy the Pane text', reply);
    let end = reply.text.length;
    while (end > 0 && reply.text[end - 1].trim() === '') end -= 1;
    return reply.text.slice(0, end).join('\n');
  }

  /** Drops a Pane's Scrollback. */
  async clearHistory(paneId: string): Promise<void> {
    await this.mustRun('clear the Scrollback', clearHistoryCommand(paneId));
  }

  /** Toggles zoom on the Session's active Pane. */
  async setZoom(sessionName: string, zoomed: boolean): Promise<void> {
    const windows = await this.listWindows(sessionName);
    const active = windows.find((window) => window.active);
    if (!active || active.zoomed === zoomed) return;
    // Zooming a Window with one Pane does nothing in tmux, and asking costs a
    // round trip nobody sees the benefit of.
    if (active.paneCount < 2) return;
    await this.mustRun('zoom Pane', zoomPaneCommand(sessionName));
  }

  /** Splits the Session's active Pane. */
  async splitWindow(sessionName: string, direction: 'right' | 'down'): Promise<void> {
    await this.mustRun('split Window', splitWindowCommand(sessionName, direction));
  }

  /** Adds a Window to the Session, after the current one. */
  async newWindow(sessionName: string): Promise<void> {
    await this.mustRun('add a Window', newWindowCommand(sessionName));
  }

  private async mustRun(what: string, argv: string[]): Promise<void> {
    const reply = await this.runner.run(argv);
    if (!reply.ok) throw failure(what, reply);
  }
}

/** A tmux count or coordinate, or 0 when it is not a number. */
function countOf(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
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
function meansNoServer(reply: CommandReply): boolean {
  const text = reply.text.join(' ').toLowerCase();
  return text.includes('no server running') || text.includes('error connecting to');
}

/** tmux's way of saying the Session or Window is gone. */
function meansMissingTarget(reply: CommandReply): boolean {
  return reply.text.join(' ').toLowerCase().includes("can't find");
}

function failure(what: string, reply: CommandReply): TmuxError {
  const detail = reply.text.join(' ').trim() || 'tmux refused it';
  return new TmuxError(`Could not ${what}: ${detail}`, detail);
}
