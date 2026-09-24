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

/**
 * Control Command listing the Panes of one Window, same shape as Windows.
 *
 * Geometry is not asked for. `#{pane_left}` and friends report where a Pane is
 * being *drawn*, which for a zoomed Pane is the whole Window — and Muxify zooms
 * by default, so those coordinates would pile every Pane on top of the active
 * one. `#{window_layout}` describes the arrangement zoom is hiding; it repeats
 * on every line, which is the price of reading it without a second round trip.
 * See parseWindowLayout.
 */
export function listPanesCommand(
  sessionName: string,
  windowIndex: number,
  tmuxExecutablePath?: string,
): string {
  return (
    `${tmux(tmuxExecutablePath)} list-panes -t ${windowTarget(sessionName, windowIndex)} ` +
    "-F '#{pane_index}\t#{pane_id}\t#{pane_current_command}\t#{pane_active}" +
    "\t#{pane_current_path}\t#{window_layout}'"
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
 * How the Session decides how big its Windows are.
 *
 * Muxify wants `smallest`, which is the only value that makes tmux's padding
 * structurally impossible. tmux pads the difference whenever a Client is bigger
 * than the Window, and `smallest` keeps the Window no bigger than the smallest
 * attached Client — so there is never a difference to pad on the Client Muxify
 * owns. With one Client attached, which is the usual case, the Window simply
 * tracks the Surface exactly.
 *
 * The rejected alternative was `manual` plus `resize-window`: two sizes, set by
 * two commands, which can only agree between round trips and pad whenever they
 * do not. See resizeClientCommand for why the Client's size is now Muxify's to
 * set, which is what makes one size enough.
 *
 * It is a session option, so it is visible to every other Client and outlives
 * the Connection: read the original first and put it back on teardown. The cost
 * of `smallest` is real — a desktop Client on the same Session is squeezed down
 * to the phone — which is exactly why it is borrowed rather than kept.
 */
export function readWindowSizingCommand(sessionName: string, tmuxExecutablePath?: string): string {
  return `${tmux(tmuxExecutablePath)} show-options -t ${shellQuote(sessionName)} -v window-size`;
}

export function setWindowSizingCommand(
  sessionName: string,
  value: string,
  tmuxExecutablePath?: string,
): string {
  return (
    `${tmux(tmuxExecutablePath)} set-option -t ${shellQuote(sessionName)} ` +
    `window-size ${shellQuote(value)}`
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
 * For the moves that change what the Client should be looking at without tmux
 * knowing the Surface needs it again from the top: switching Session, taking a
 * Session over, following a Window that was drawn at another size.
 *
 * Not for resizes. tmux repaints a Client itself when its pty changes size, and
 * an extra full repaint on every frame of a keyboard animation is a flash the
 * user sees. It used to be needed there because the Client's size could not be
 * changed at all, so tmux never knew a resize had happened — see
 * resizeClientCommand, which is what removed the need.
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
 * impossible — because on `window-size smallest` the Window follows the Client
 * inside the tmux server, in the same instant, with no second round trip to be
 * caught halfway through. This is the only size Muxify sets.
 *
 * GNU `stty` takes `-F` and BSD's takes `-f`, and the Host may be either, so
 * the command tries one and falls back to the other.
 */
export function resizeClientCommand(clientTty: string, cols: number, rows: number): string {
  const tty = shellQuote(clientTty);
  const size = `rows ${Math.max(1, Math.floor(rows))} cols ${Math.max(1, Math.floor(cols))}`;
  return `stty -F ${tty} ${size} 2>/dev/null || stty -f ${tty} ${size}`;
}
