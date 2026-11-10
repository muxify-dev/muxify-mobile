/**
 * Construction of the tmux commands Muxify sends.
 *
 * Two shapes exist, and the difference is who parses the line.
 *
 * - **Down the Control Connection.** tmux itself reads the line, so it is
 *   built as an argument list and rendered with tmux's quoting. There is no
 *   shell anywhere on this path and no `tmux` at the front: the command is
 *   already inside tmux.
 * - **On an exec channel.** Only the two things that happen before there is a
 *   Session to attach to — listing a Host's Sessions and making one. A shell
 *   reads that line, so it is rendered with shell quoting and the tmux binary
 *   in front.
 *
 * Commands are argument lists rather than strings for exactly that reason: the
 * same command has to be quoted two different ways, and a string built for one
 * is wrong for the other in a way nothing catches until a Session name has a
 * quote in it.
 *
 * Pure string building, no transport.
 */

/** One tmux command: the verb and its arguments, unquoted. */
export type TmuxArgv = string[];

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

/**
 * Wraps a value so tmux's own parser treats it as one literal argument.
 *
 * Measured against tmux 3.7c, by sending values through as `-t` targets and
 * reading the name back out of the error tmux answered with.
 *
 * Single quotes are wholly literal to tmux's lexer — `$`, `\`, `"`, `#`, `;`
 * and spaces all pass through untouched, including a backslash at the very
 * end. So they are used whenever the value has no single quote in it, which is
 * every Session name anyone has ever typed.
 *
 * A value that does contain one has to go in double quotes, where tmux expands
 * `${...}` and reads `\` as an escape; both are escaped, and `"` with them.
 *
 * What quoting cannot do anything about: some commands run their own format
 * expansion over an argument *after* tmux has lexed it — `new-session -s`
 * does, so a Session named `a#{b}c` is created as `ac`. That is tmux's
 * behaviour towards its own user, not something a client can or should undo.
 */
export function tmuxQuote(value: string): string {
  if (!value.includes("'") && !/[\x00-\x1f\x7f]/.test(value)) return `'${value}'`;
  return `"${value.replace(/[\x00-\x1f\x7f\\"$]/g, (character) =>
    /[\x00-\x1f\x7f]/.test(character)
      ? `\\${character.charCodeAt(0).toString(8).padStart(3, '0')}`
      : `\\${character}`,
  )}"`;
}

/**
 * Every argument is quoted, including the flags and the command name.
 *
 * Tempting to leave `-t` and `list-windows` bare for readability, and wrong:
 * quoting is what stops a *value* being read as syntax, and the way to decide
 * which is which would have to be a list of known flags. A Session named `-t`
 * would then match that list and go through unquoted. tmux's own lexer strips
 * the quotes before `getopt` sees anything, so a quoted flag is still a flag
 * and a quoted value is still a value — which makes quoting everything both
 * simpler and the only version with no gap in it.
 */

/** An argument list as one line for the Control Connection. */
export function renderControlCommand(argv: TmuxArgv): string {
  return argv.map(tmuxQuote).join(' ');
}

/**
 * A command as the Log may name it.
 *
 * Everything but what the user typed. `send-keys -H` carries the keystrokes
 * as hex, so a Log that quoted it would be a Log of passwords; it is written
 * down as a count of bytes instead. A named key from the Key Row — `Up`,
 * `C-c` — is a key and not text, and stays.
 */
export function describeCommand(argv: TmuxArgv): string {
  if (argv[0] === 'set-buffer') return `set-buffer (${argv.at(-1)?.length ?? 0} characters)`;
  if (argv[0] !== 'send-keys') return argv.join(' ');
  const target = argv.indexOf('-t');
  const named = target >= 0 ? argv[target + 1] : '?';
  const hex = argv.indexOf('-H');
  if (hex >= 0) return `send-keys -t ${named} -H (${argv.length - hex - 1} bytes)`;
  return `send-keys -t ${named} ${argv.slice(target + 2).join(' ')}`;
}

/** An argument list as one line for a shell, with the tmux binary in front. */
export function renderExecCommand(argv: TmuxArgv, tmuxExecutablePath?: string): string {
  const tmux = tmuxExecutablePath ? shellQuote(tmuxExecutablePath) : 'tmux';
  return [tmux, ...argv.map(shellQuote)].join(' ');
}

/**
 * The shell command line the Control Connection's channel runs.
 *
 * `-C` is control mode; `attach-session` rather than `new-session -A`, because
 * Muxify only ever attaches to a Session that already exists and `-A` would
 * silently create one. No PTY is requested for this channel — see the
 * transport seam — which is what leaves the Session's options alone.
 */
export function controlAttachCommand(sessionName: string, tmuxExecutablePath?: string): string {
  return renderExecCommand(['-C', 'attach-session', '-t', sessionName], tmuxExecutablePath);
}

/**
 * Lists Sessions: how many Windows each holds, and its name.
 *
 * The name comes first because a Session name may contain a tab and the count
 * beside it may not — see splitFields, which rejoins the overflow into the
 * field before the last one, which with two fields is the first.
 *
 * Whether anyone is attached is deliberately not asked for. It was a warning
 * that joining would shrink somebody's Window, which was true while Muxify
 * borrowed `window-size smallest` and is not true of a control client.
 *
 * Run on an exec channel from the Host Screen, and down the Control Connection
 * from the Session picker. The same arguments serve both.
 *
 * A Host with no tmux server running fails here; that is an empty Session
 * list, not a failure, and the caller must treat it as such.
 */
export function listSessionsCommand(): TmuxArgv {
  return [
    'list-sessions',
    '-F',
    '#{session_name}\t#{session_windows}',
  ];
}

/**
 * Creates a Session and leaves it running, detached.
 *
 * Detached (`-d`) because attaching is a separate step a moment later, and
 * because the channel this runs on has no terminal to hand a foreground
 * Session.
 *
 * `new-session` rather than `new-session -A`: if the name is already taken
 * this must fail loudly rather than silently hand back someone else's Session.
 * See ADR 0005.
 */
export function createSessionCommand(name: string): TmuxArgv {
  return ['new-session', '-d', '-s', name];
}

/** Addresses a Window as tmux writes it: `session:window`. */
function windowTarget(sessionName: string, windowIndex: number): string {
  return `${sessionName}:${windowIndex}`;
}

/**
 * Addresses whatever is current in a Session: its active Pane, in its current
 * Window.
 *
 * The trailing colon is load-bearing. A bare name is an *ambiguous* target:
 * tmux will read it as a Session, a Window index or a Pane index depending on
 * what it finds, and tmux's own default Session name is `0` — so `-t 0`
 * resolves to Pane 0 and every command aimed at "the current Pane" silently
 * hits the first one instead. The colon forces the Session reading.
 */
function currentPaneTarget(sessionName: string): string {
  return `${sessionName}:`;
}

/**
 * Lists the Windows of a Session: tmux's own id, the index, whether it is
 * active, how many Panes it holds, whether it is zoomed, what its active Pane
 * is running, and its name.
 *
 * The id is what notifications address a Window by — `%window-renamed @2 logs`
 * — so without it a pushed change could not be applied to the Window it is
 * about, and every notification would cost a re-read.
 *
 * The name sits second to last, as it does in the Sessions listing and for the
 * same reason: it is the one field that may contain a tab, and splitFields
 * rejoins the overflow into that position. Tab is the separator because a name
 * may contain spaces and colons but rarely a tab.
 */
export function listWindowsCommand(sessionName: string): TmuxArgv {
  return [
    'list-windows',
    '-t',
    sessionName,
    '-F',
    '#{window_id}\t#{window_index}\t#{window_active}\t#{window_panes}' +
      '\t#{window_zoomed_flag}\t#{window_name}\t#{pane_current_command}',
  ];
}

/**
 * Lists the Panes of one Window, same shape as Windows.
 *
 * Geometry is not asked for. `#{pane_left}` and friends report where a Pane is
 * being *drawn*, which for a zoomed Pane is the whole Window — and Muxify zooms
 * by default, so those coordinates would pile every Pane on top of the active
 * one. `#{window_layout}` describes the arrangement zoom is hiding; it repeats
 * on every line, which is the price of reading it without a second round trip.
 * See parseWindowLayout.
 */
export function listPanesCommand(sessionName: string, windowIndex: number): TmuxArgv {
  return [
    'list-panes',
    '-t',
    windowTarget(sessionName, windowIndex),
    '-F',
    '#{pane_index}\t#{pane_id}\t#{pane_current_command}\t#{pane_active}' +
      '\t#{pane_current_path}\t#{window_layout}',
  ];
}

/** Moves the Client to another Window. */
export function selectWindowCommand(sessionName: string, windowIndex: number): TmuxArgv {
  return ['select-window', '-t', windowTarget(sessionName, windowIndex)];
}

/**
 * Moves the Client to another Pane, carrying the Zoom across.
 *
 * `-Z` is the whole of how Zoom survives picking a Pane, and it has to be tmux
 * that does it. A plain `select-pane` on a zoomed Window unzooms it, and a
 * control client is told so: measured on tmux 3.6, it publishes one
 * `%layout-change` whose flags are `*` — no `Z` — and the Panes appear as a
 * split. Putting the zoom back afterwards is two more round trips, and for
 * both of them the phone is drawing the split it is about to throw away, which
 * reads as a flick from one layout to the other on every tap.
 *
 * With `-Z` there is nothing to put back. tmux keeps the Window zoomed across
 * the selection and never publishes the unzoomed layout at all: the same
 * measurement shows `%layout-change … *Z`, `%window-pane-changed`,
 * `%layout-change … *Z`, and the newly picked Pane is the one filling the
 * Window. An unzoomed Window is left alone, so this is only ever "keep what is
 * there".
 */
export function selectPaneCommand(
  sessionName: string,
  windowIndex: number,
  paneIndex: number,
): TmuxArgv {
  return ['select-pane', '-Z', '-t', `${sessionName}:${windowIndex}.${paneIndex}`];
}

/**
 * Points the Client at a different Session.
 *
 * This is how switching Session happens without tearing down the Control
 * Connection: the client follows, `%session-changed` arrives, and the Surface
 * is resynced from the new Session's Pane.
 */
export function switchSessionCommand(sessionName: string): TmuxArgv {
  return ['switch-client', '-t', sessionName];
}

/**
 * Tells tmux how big this Client is.
 *
 * The one thing a control client has to ask for. Measured against tmux 3.7c:
 * an unsized control client does not drag the Window at all — one reporting 80
 * columns sat on a 120x40 Window and left it there — and `refresh-client -C`
 * is what moves it. So sizing is opt-in, and Muxify has to opt in or the
 * Window never matches the phone.
 *
 * This sets no Session option. Under the default `window-size latest` the
 * Window follows the latest Client, and reverts when the Client goes. Nothing
 * is left behind to restore, which is the whole of ADR 0006. Asking for a size
 * is not enough to be the latest, though: see claimWindowCommand.
 */
export function resizeClientCommand(cols: number, rows: number): TmuxArgv {
  return ['refresh-client', '-C', `${size(cols)}x${size(rows)}`];
}

/**
 * Makes this Client the latest one on its Window, so the size it asks for next
 * is the size the Window takes.
 *
 * Measured against tmux 3.8 with a laptop client and a control client on one
 * Window. Once the laptop has typed, it is the latest, and `refresh-client -C`
 * from the control client changes nothing — not again, not at another size and
 * back. `send-keys` does not count as activity either. A bare `select-window`
 * does: it selects the Window that is already selected, which leaves the
 * Session's last-window mark alone, and it makes the control client the latest.
 * The phone got 115 columns of Claude Code written into a 49-column Surface
 * before this.
 */
export function claimWindowCommand(): TmuxArgv {
  return ['select-window'];
}

function size(value: number): number {
  return Math.max(1, Math.floor(value));
}

/**
 * Carries arbitrary bytes into a Pane.
 *
 * `-H` takes one hex byte per argument, which is how typed input reaches a
 * Pane with no PTY anywhere in the path. It is also why tmux's prefix key
 * never fires: these bytes go *into* the Pane, not through tmux's key table.
 * Every tmux verb therefore has to come from the app's own chrome. See ADR 0006.
 */
export function sendKeysCommand(paneId: string, bytes: Uint8Array): TmuxArgv {
  const hex: string[] = [];
  for (const byte of bytes) hex.push(byte.toString(16).padStart(2, '0'));
  return ['send-keys', '-t', paneId, '-H', ...hex];
}

/**
 * Sends one named key into a Pane.
 *
 * The name rather than the bytes, because which bytes are right depends on
 * what the Pane is running and only tmux knows. Measured on tmux 3.6: Up into
 * a shell is `ESC [ A`, and Up into anything that has turned DECCKM on — vim,
 * less, a full-screen TUI — is `ESC O A`. Sending the bytes from here would
 * mean tracking that mode per Pane, which is a second model of tmux's state of
 * exactly the kind ADR 0006 declined to keep.
 *
 * Not through tmux's key table either: `send-keys` puts the key into the Pane,
 * so a Meta key that happens to be the prefix is still just a key.
 */
export function sendKeyCommand(paneId: string, key: string): TmuxArgv {
  return ['send-keys', '-t', paneId, key];
}

/**
 * Reads back what is already on a Pane's screen.
 *
 * `%output` only carries what happens *next*, so a Surface that has just
 * attached would show an empty screen until something moved. This is the
 * missing half: the Pane as it already is.
 *
 * `-e` keeps the colours as escape sequences, `-N` keeps trailing spaces, and
 * `-p` writes to the reply rather than a buffer. No `-J`: joining wrapped
 * lines would reflow the screen to a width that is not the Pane's.
 */
export function capturePaneCommand(paneId: string): TmuxArgv {
  return ['capture-pane', '-t', paneId, '-p', '-e', '-N'];
}

/**
 * The same, over a range of the Pane's Scrollback.
 *
 * Negative line numbers are above the top of the screen: `-S -30 -E -1` is the
 * thirty lines that have scrolled off. This is how the Scrollback is read now
 * that tmux's copy-mode is not involved — see ticket 06.
 */
export function captureScrollbackCommand(
  paneId: string,
  startLine: number,
  endLine: number,
): TmuxArgv {
  return [
    'capture-pane',
    '-t',
    paneId,
    '-p',
    '-e',
    '-N',
    '-S',
    String(Math.floor(startLine)),
    '-E',
    String(Math.floor(endLine)),
  ];
}

/**
 * What a Selection needs of a range of a Pane, read in one go: how long the
 * Scrollback is, the rows as they are painted, and the same lines with the
 * wrapped rows joined.
 *
 * Written together so that tmux answers all three from one screen. The
 * Scrollback's length turns the range, which counts from the top of the
 * screen, into lines that keep their number while output arrives. The joined
 * capture is the only place tmux says which rows it wrapped.
 */
export function captureSelectionCommands(
  paneId: string,
  startLine: number,
  endLine: number,
): TmuxArgv[] {
  const range = ['-S', String(Math.floor(startLine)), '-E', String(Math.floor(endLine))];
  return [
    ['display-message', '-p', '-t', paneId, '#{history_size}'],
    ['capture-pane', '-t', paneId, '-p', '-e', '-N', ...range],
    ['capture-pane', '-t', paneId, '-p', '-J', ...range],
  ];
}

/**
 * Everything about a Pane that a resync needs and the Layout does not say:
 * where the cursor is and whether the application shows it, whether the Pane is on the alternate screen, how much
 * Scrollback it has (tmux calls that `history_size`), and how big it is.
 *
 * The last two decide how a scroll behaves. On the alternate screen the
 * application is scrolling itself, so the gesture becomes input: wheel bytes
 * when it asked for the mouse, cursor keys when it did not — `less` and `man`
 * read nothing else, and tmux 3.6 dropped the `alternate-scroll` option that
 * used to do that translation. On the normal screen the gesture becomes a
 * `capture-pane` over the Scrollback instead. See ticket 06.
 */
export function paneStateCommand(paneId: string): TmuxArgv {
  return [
    'display-message',
    '-p',
    '-t',
    paneId,
    '#{cursor_x}\t#{cursor_y}\t#{alternate_on}\t#{history_size}' +
      '\t#{pane_width}\t#{pane_height}\t#{mouse_any_flag}\t#{cursor_flag}\t#{bracket_paste_flag}',
  ];
}

/**
 * Captures what several Panes are showing, one command each.
 *
 * Written together and answered together, so a picker full of previews costs
 * one round trip rather than one per Pane — see `runAll`. Control mode is what
 * makes that possible: each command gets its own `%begin`/`%end`, so the
 * captures come back already separated. The exec path had to chain them with
 * `;` and put a marker between them, because a shell hands back one stream.
 *
 * No `-e` here, unlike a resync: a preview is drawn as plain text, and colour
 * escapes would be shown rather than obeyed.
 */
export function capturePanesCommand(targets: string[]): TmuxArgv[] {
  return targets.map((target) => ['capture-pane', '-t', target, '-p']);
}

/**
 * A Pane's text, for the clipboard.
 *
 * No `-e`: this is pasted into a chat or a file, where colour escapes are
 * noise. `-J` joins the lines the Pane wrapped, so a long command comes back
 * as the one line it was typed as.
 */
export function capturePaneTextCommand(paneId: string): TmuxArgv {
  return ['capture-pane', '-t', paneId, '-p', '-J'];
}

/**
 * Drops a Pane's Scrollback. What is on its screen stays.
 *
 * Not `send-keys -R` in front of it, which is the usual way to take the
 * screen too. Measured on tmux 3.8: `-R` resets the modes the program in the
 * Pane asked for. A program that hid the cursor gets it back, DECCKM goes off,
 * and bracketed paste goes off, so the next multi-line paste runs line by
 * line. The program clears its own screen instead; see `clearPane` in attach.
 */
export function clearHistoryCommand(paneId: string): TmuxArgv {
  return ['clear-history', '-t', paneId];
}

/**
 * Toggles zoom on a Window's active Pane.
 *
 * tmux has no "zoom on" — `-Z` toggles — so the caller has to know the current
 * state, which `listWindowsCommand` reports as the zoomed flag.
 *
 * Aimed with a trailing colon; see currentPaneTarget for what a bare Session
 * name does instead, which is zoom the wrong Pane and select it into the
 * bargain.
 */
export function zoomPaneCommand(sessionName: string): TmuxArgv {
  return ['resize-pane', '-Z', '-t', currentPaneTarget(sessionName)];
}

/**
 * Splits the current Pane, beside it or below it. Aimed with a trailing colon
 * — see currentPaneTarget — or it splits the first Pane rather than the one
 * the user is looking at.
 */
export function splitWindowCommand(sessionName: string, direction: 'right' | 'down'): TmuxArgv {
  return [
    'split-window',
    direction === 'right' ? '-h' : '-v',
    '-t',
    currentPaneTarget(sessionName),
  ];
}

/** Adds a Window to a Session, after the current one. */
export function newWindowCommand(sessionName: string): TmuxArgv {
  return ['new-window', '-a', '-t', currentPaneTarget(sessionName)];
}
