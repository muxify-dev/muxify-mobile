/**
 * Construction of the tmux commands Muxify sends over SSH.
 *
 * Two shapes exist. The Shell Channel runs exactly one long-lived command —
 * an attach — with a PTY. Everything else is a Control Command: a one-shot
 * tmux invocation on its own exec channel, stdout only, never interactive.
 * See ADR 0001 for why this is not tmux control mode.
 *
 * Pure string building, no transport. Ticket 06 puts a TmuxClient in front of
 * this; the strings themselves stay testable on their own.
 */

/**
 * Wraps a value in single quotes so a shell treats it as one literal argument.
 *
 * Session names come from the remote machine and Host paths come from user
 * input, so both reach a shell as untrusted text. Single quotes disable every
 * form of expansion; the only character that needs care is the single quote
 * itself, which is closed, escaped and reopened.
 */
export function shellQuote(value: string): string {
  return `'${value.split("'").join("'\\''")}'`;
}

/** `tmux`, or the Host's explicit path when it provides one. */
function tmux(executablePath?: string): string {
  return executablePath ? shellQuote(executablePath) : 'tmux';
}

/**
 * Control Command listing Session names, one per line.
 *
 * A Host with no tmux server running exits non-zero here; that is an empty
 * Session list, not a failure, and the caller must treat it as such.
 */
export function listSessionsCommand(tmuxExecutablePath?: string): string {
  return `${tmux(tmuxExecutablePath)} list-sessions -F '#{session_name}\t#{session_windows}'`;
}

/**
 * The command the Shell Channel runs to Attach.
 *
 * `attach-session`, never `new-session -A`: Muxify only ever attaches to a
 * Session that already exists, and the `-A` form would silently create one.
 */
export function attachSessionCommand(sessionName: string, tmuxExecutablePath?: string): string {
  return `${tmux(tmuxExecutablePath)} attach-session -t ${shellQuote(sessionName)}`;
}

/** Addresses a Window as tmux writes it: `session:window`. */
function windowTarget(sessionName: string, windowIndex: number): string {
  return shellQuote(`${sessionName}:${windowIndex}`);
}

/**
 * Control Command listing the Windows of a Session: index, name and whether it
 * is the active one, tab separated. Tab is the separator because a Window name
 * may contain spaces and colons but not a tab.
 */
export function listWindowsCommand(sessionName: string, tmuxExecutablePath?: string): string {
  return (
    `${tmux(tmuxExecutablePath)} list-windows -t ${shellQuote(sessionName)} ` +
    "-F '#{window_index}\t#{window_name}\t#{window_active}\t#{window_panes}" +
    "\t#{window_zoomed_flag}\t#{pane_current_command}'"
  );
}

/** Control Command listing the Panes of one Window, same shape as Windows. */
export function listPanesCommand(
  sessionName: string,
  windowIndex: number,
  tmuxExecutablePath?: string,
): string {
  return (
    `${tmux(tmuxExecutablePath)} list-panes -t ${windowTarget(sessionName, windowIndex)} ` +
    "-F '#{pane_index}\t#{pane_current_command}\t#{pane_active}\t#{pane_title}" +
    "\t#{pane_left}\t#{pane_top}\t#{pane_width}\t#{pane_height}'"
  );
}

/** Control Command moving the attached client to another Window. */
export function selectWindowCommand(
  sessionName: string,
  windowIndex: number,
  tmuxExecutablePath?: string,
): string {
  return `${tmux(tmuxExecutablePath)} select-window -t ${windowTarget(sessionName, windowIndex)}`;
}

/** Control Command moving the attached client to another Pane. */
export function selectPaneCommand(
  sessionName: string,
  windowIndex: number,
  paneIndex: number,
  tmuxExecutablePath?: string,
): string {
  const target = shellQuote(`${sessionName}:${windowIndex}.${paneIndex}`);
  return `${tmux(tmuxExecutablePath)} select-pane -t ${target}`;
}

/**
 * Control Command pointing the attached client at a different Session.
 *
 * This is how Session switching happens without tearing down the Shell
 * Channel: the client follows, and the Surface simply redraws.
 */
export function switchSessionCommand(sessionName: string, tmuxExecutablePath?: string): string {
  return `${tmux(tmuxExecutablePath)} switch-client -t ${shellQuote(sessionName)}`;
}

/**
 * Control Commands that force a Session's Window to an explicit size.
 *
 * Needed because `@osuki-dev/react-native-ssh`'s `resize()` does not reliably
 * send the SSH window-change request, leaving the remote terminal at a stale
 * size. tmux then draws for the size it believes it has, so rows outside the
 * Surface's real grid are never shown. Driving the size through tmux instead
 * uses the exec channel, which is reliable.
 *
 * `window-size manual` is required: without it tmux sizes the Window from its
 * attached clients and ignores `resize-window`. It is a session option and it
 * persists on the Host after Muxify disconnects.
 */
export function manualWindowSizeCommand(sessionName: string, tmuxExecutablePath?: string): string {
  return `${tmux(tmuxExecutablePath)} set-option -t ${shellQuote(sessionName)} window-size manual`;
}

export function resizeWindowCommand(
  sessionName: string,
  cols: number,
  rows: number,
  tmuxExecutablePath?: string,
): string {
  return (
    `${tmux(tmuxExecutablePath)} resize-window -t ${shellQuote(sessionName)} ` +
    `-x ${Math.max(1, Math.floor(cols))} -y ${Math.max(1, Math.floor(rows))}`
  );
}

/**
 * Control Commands for the Session's status line.
 *
 * remux never needs these: it drives tmux in control mode, where the client
 * renders nothing itself and tmux streams pane content instead, so no status
 * line exists. Muxify attaches a real client (ADR 0001), so tmux draws its full
 * chrome — including a status line that duplicates what the Dock already shows.
 *
 * `status` is a session option, so turning it off is visible to every other
 * client of that Session and outlives the Connection. Read the original value
 * first and put it back on teardown.
 */
export function readStatusLineCommand(sessionName: string, tmuxExecutablePath?: string): string {
  return `${tmux(tmuxExecutablePath)} show-options -t ${shellQuote(sessionName)} -v status`;
}

export function setStatusLineCommand(
  sessionName: string,
  value: string,
  tmuxExecutablePath?: string,
): string {
  return `${tmux(tmuxExecutablePath)} set-option -t ${shellQuote(sessionName)} status ${shellQuote(value)}`;
}

/**
 * Control Command listing the Session's Clients, newest last: creation time
 * and tty, tab separated.
 *
 * The tty is how a Client is addressed. Muxify needs its own, because a
 * Session may have other Clients — the whole point of tmux — and a redraw
 * aimed at the wrong one leaves the Surface dirty.
 */
export function listClientsCommand(sessionName: string, tmuxExecutablePath?: string): string {
  return (
    `${tmux(tmuxExecutablePath)} list-clients -t ${shellQuote(sessionName)} ` +
    "-F '#{client_created}\t#{client_tty}'"
  );
}

/**
 * Control Command forcing a Client to repaint everything it is showing.
 *
 * Needed because a resize leaves debris. While the tmux Window is smaller than
 * the Client, tmux pads the rows it is not drawing with dots; those rows are
 * off the bottom of a shrunken Surface, so they are painted unseen and then
 * revealed the moment the Surface grows back. tmux will not clean them up on
 * its own — it believes the Client is still the old size and those rows are
 * not its to draw — so the padding stays until something forces a full redraw.
 *
 * Without a tty tmux picks whichever Client it considers best, which is right
 * only when the Session has exactly one.
 */
export function redrawClientCommand(clientTty?: string, tmuxExecutablePath?: string): string {
  const command = `${tmux(tmuxExecutablePath)} refresh-client`;
  return clientTty === undefined ? command : `${command} -t ${shellQuote(clientTty)}`;
}

/** Separates one Pane's captured content from the next in a batched capture. */
export const CAPTURE_SEPARATOR = '@@muxify@@';

/**
 * Control Command capturing what several Panes are showing, in one round trip.
 *
 * One exec per Pane would be a round trip each, and a picker that takes a
 * second to fill is a picker nobody opens. tmux has no batch form, so the
 * commands are chained with `;` — which every POSIX shell and fish agree on,
 * unlike a pipeline or a loop.
 *
 * `capture-pane -p` gives the visible region, which is exactly what a preview
 * wants: what that Pane looks like right now.
 */
export function capturePanesCommand(targets: string[], tmuxExecutablePath?: string): string {
  const tmuxPath = tmux(tmuxExecutablePath);
  return targets
    .map((target) => `${tmuxPath} capture-pane -t ${shellQuote(target)} -p`)
    .join(` ; echo ${shellQuote(CAPTURE_SEPARATOR)} ; `);
}

/**
 * Control Command toggling zoom on a Window's active Pane.
 *
 * tmux has no "zoom on" — `-Z` toggles — so the caller has to know the current
 * state, which `listWindowsCommand` reports as the zoomed flag.
 */
export function zoomPaneCommand(sessionName: string, tmuxExecutablePath?: string): string {
  return `${tmux(tmuxExecutablePath)} resize-pane -Z -t ${shellQuote(sessionName)}`;
}

/** Control Command splitting the current Pane, beside it or below it. */
export function splitWindowCommand(
  sessionName: string,
  direction: 'right' | 'down',
  tmuxExecutablePath?: string,
): string {
  const flag = direction === 'right' ? '-h' : '-v';
  return `${tmux(tmuxExecutablePath)} split-window ${flag} -t ${shellQuote(sessionName)}`;
}

/** Control Command adding a Window to a Session, after the current one. */
export function newWindowCommand(sessionName: string, tmuxExecutablePath?: string): string {
  return `${tmux(tmuxExecutablePath)} new-window -a -t ${shellQuote(`${sessionName}:`)}`;
}

/**
 * Resizes the Client's pseudo-terminal from the Host side.
 *
 * This is the answer to the SSH library not sending window-change requests: it
 * never needed to. The Client's size lives in a pty on the Host, and the Host
 * can set it — `stty` on the tty tmux is attached to sends SIGWINCH to the
 * tmux client, which is exactly what a real terminal emulator's resize does.
 * It goes over the exec channel, which has been reliable all along.
 *
 * Why this matters: tmux pads every row between the Window and the Client with
 * dots, and those rows land past the end of the Surface's grid. A Client size
 * that cannot be changed makes that padding unavoidable; one that can makes it
 * impossible.
 *
 * GNU `stty` takes `-F` and BSD's takes `-f`, and the Host may be either, so
 * the command tries one and falls back to the other.
 */
export function resizeClientCommand(clientTty: string, cols: number, rows: number): string {
  const tty = shellQuote(clientTty);
  const size = `rows ${Math.max(1, Math.floor(rows))} cols ${Math.max(1, Math.floor(cols))}`;
  return `stty -F ${tty} ${size} 2>/dev/null || stty -f ${tty} ${size}`;
}
