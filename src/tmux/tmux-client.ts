import {
  attachSessionCommand,
  listPanesCommand,
  listSessionsCommand,
  listWindowsCommand,
  selectPaneCommand,
  selectWindowCommand,
  switchSessionCommand,
} from './commands';
import type { TmuxExecResult, TmuxShell, TmuxShellEvents, TmuxTransport } from './transport';

/** A tmux Window inside a Session. */
export interface Window {
  index: number;
  name: string;
  active: boolean;
}

/** A tmux Pane inside a Window. */
export interface Pane {
  index: number;
  /** The command currently running in the Pane, as tmux reports it. */
  command: string;
  active: boolean;
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
  async listSessions(): Promise<string[]> {
    const result = await this.transport.exec(listSessionsCommand(this.tmuxExecutablePath));

    if (result.exitCode !== 0) {
      if (meansNoServer(result)) return [];
      throw failure('list Sessions', result);
    }

    return nonEmptyLines(result.stdout);
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
      const fields = splitFields(line, 3);
      if (!fields) return [];
      const [index, name, active] = fields;
      const parsed = Number(index);
      if (!Number.isInteger(parsed)) return [];
      return [{ index: parsed, name, active: active === '1' }];
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
      const fields = splitFields(line, 3);
      if (!fields) return [];
      const [index, command, active] = fields;
      const parsed = Number(index);
      if (!Number.isInteger(parsed)) return [];
      return [{ index: parsed, command, active: active === '1' }];
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
