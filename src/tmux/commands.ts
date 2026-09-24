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
  return `${tmux(tmuxExecutablePath)} list-sessions -F '#{session_name}'`;
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
