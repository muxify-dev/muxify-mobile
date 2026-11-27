import {
  capturePaneCommand,
  capturePaneTextCommand,
  captureScrollbackCommand,
  capturePanesCommand,
  controlAttachCommand,
  createSessionCommand,
  deliverCommands,
  describeCommand,
  guardsLateLines,
  listPanesCommand,
  listSessionsCommand,
  listWindowsCommand,
  newWindowCommand,
  parseSessionOp,
  paneStateCommand,
  parsePaneMark,
  renderControlCommand,
  renderExecCommand,
  listSessionPanesCommand,
  reportPaneColoursCommands,
  resizeClientCommand,
  selectPaneCommand,
  selectPaneTowardCommand,
  selectWindowCommand,
  sendKeyCommand,
  sendKeysCommand,
  shellQuote,
  splitWindowCommand,
  verbCommands,
  stagePasteCommands,
  switchSessionCommand,
  tmuxQuote,
  zoomPaneCommand,
} from './commands';
import type { Seq } from './input-lane';
import type { Op } from './verb-guard';

describe('quoting for a shell', () => {
  it('wraps a value so no expansion can reach it', () => {
    expect(shellQuote('work')).toBe("'work'");
    expect(shellQuote('$HOME; rm -rf /')).toBe("'$HOME; rm -rf /'");
  });

  it('survives a single quote in the value', () => {
    expect(shellQuote("it's")).toBe("'it'\\''s'");
  });
});

describe('quoting for tmux itself', () => {
  // Measured against tmux 3.7c by sending each value through as a `-t` target
  // and reading the name back out of the error tmux answered with.
  it('single-quotes a value, which tmux reads wholly literally', () => {
    expect(tmuxQuote('a b"c#{g}h;i$x\\y')).toBe("'a b\"c#{g}h;i$x\\y'");
  });

  it('single-quotes a value ending in a backslash', () => {
    expect(tmuxQuote('ends-with\\')).toBe("'ends-with\\'");
  });

  it('double-quotes a value that holds a single quote, escaping what tmux reads', () => {
    expect(tmuxQuote("it's $HOME \\ \"q\"")).toBe('"it\'s \\$HOME \\\\ \\"q\\""');
  });
});

describe('rendering an argument list', () => {
  it('quotes every argument, flags and command name included', () => {
    expect(renderControlCommand(['select-window', '-t', 'work:2'])).toBe(
      "'select-window' '-t' 'work:2'",
    );
  });

  it('cannot be fooled by a Session named like a flag', () => {
    // Quoting is what stops a value being read as syntax, so a Session called
    // `-t` has to be quoted like any other value — which is why there is no
    // list of known flags to be absent from.
    expect(renderControlCommand(['switch-client', '-t', '-t'])).toBe(
      "'switch-client' '-t' '-t'",
    );
  });

  it('puts tmux in front for a shell, and only there', () => {
    expect(renderExecCommand(['list-sessions'])).toBe("tmux -u 'list-sessions'");
    expect(renderExecCommand(['list-sessions'], '/opt/homebrew/bin/tmux')).toBe(
      "'/opt/homebrew/bin/tmux' -u 'list-sessions'",
    );
  });
});

describe('attaching', () => {
  it('runs tmux in control mode, attaching to a Session that exists', () => {
    expect(controlAttachCommand('work')).toBe("tmux -u '-C' 'attach-session' '-t' 'work'");
  });

  it('never creates a Session on the way in', () => {
    expect(controlAttachCommand('work')).not.toContain('new-session');
  });
});

describe('reading what is there', () => {
  it('asks for the fields a Session picker shows', () => {
    const read = listSessionsCommand();
    expect(read.argv).toEqual([
      'list-sessions',
      '-F',
      `${read.tag}#{session_name}\t#{session_windows}`,
    ]);
  });

  it('never asks whether anyone is attached', () => {
    // That was a warning that joining would shrink somebody's Window, which a
    // control client cannot do. See ADR 0006.
    expect(listSessionsCommand().argv.join(' ')).not.toContain('session_attached');
  });

  it('puts the Session name where a tab in it cannot shift the count', () => {
    const read = listSessionsCommand();
    const fields = read.argv[2].split('\t');
    expect(fields[fields.length - 2]).toBe(`${read.tag}#{session_name}`);
  });

  it('asks a Window for its layout rather than its Panes’ coordinates', () => {
    const format = listPanesCommand('work', 1).argv[4];
    expect(format).toContain('#{window_layout}');
    expect(format).not.toContain('#{pane_left}');
  });

  it('addresses a Window as session:index', () => {
    expect(listWindowsCommand('work').argv).toEqual([
      'list-windows',
      '-t',
      'work',
      expect.any(String),
      expect.any(String),
    ]);
    expect(listPanesCommand('work', 3).argv[2]).toBe('work:3');
  });
});

describe('moving around', () => {
  it('selects a Window and a Pane by target', () => {
    expect(selectWindowCommand('work', 2)).toEqual(['select-window', '-t', 'work:2']);
    // `-Z` and not by accident: a plain select-pane unzooms a zoomed Window,
    // and the phone then draws the split for the two round trips it takes to
    // put the zoom back. See selectPaneCommand.
    expect(selectPaneCommand('work', 2, 1)).toEqual(['select-pane', '-Z', '-t', 'work:2.1']);
    expect(selectPaneTowardCommand('0', 'left')).toEqual(['select-pane', '-Z', '-L', '-t', '0:']);
  });

  it('switches the Client rather than reconnecting', () => {
    expect(switchSessionCommand('play')).toEqual(['switch-client', '-t', 'play']);
  });

  it('aims the Session-wide verbs with a trailing colon', () => {
    // A bare name is ambiguous: tmux's own default Session is called `0`, so
    // `-t 0` resolves to Pane 0 and every one of these hits the wrong thing.
    expect(zoomPaneCommand('0')).toEqual(['resize-pane', '-Z', '-t', '0:']);
    expect(splitWindowCommand('0', 'right')).toEqual(['split-window', '-h', '-t', '0:']);
    expect(splitWindowCommand('0', 'down')).toEqual(['split-window', '-v', '-t', '0:']);
    expect(newWindowCommand('0')).toEqual(['new-window', '-a', '-t', '0:']);
  });

  it('creates a Session detached, and never with -A', () => {
    expect(createSessionCommand('work')).toEqual(['new-session', '-d', '-s', 'work']);
  });
});

describe('sizing the Client', () => {
  it('asks with refresh-client, setting no Session option', () => {
    expect(resizeClientCommand(40, 20)).toEqual(['refresh-client', '-C', '40x20']);
  });

  it('never asks for a size tmux would refuse', () => {
    expect(resizeClientCommand(0, -3)).toEqual(['refresh-client', '-C', '1x1']);
    expect(resizeClientCommand(40.7, 20.2)).toEqual(['refresh-client', '-C', '40x20']);
  });
});

describe('reporting a Pane’s colours', () => {
  it('writes each colour as the OSC reply tmux answers the Pane with', () => {
    // These two lines, sent down a control client on tmux 3.8, made tmux
    // answer the Pane's OSC 10 and OSC 11 queries with these colours.
    expect(reportPaneColoursCommands('%0', { foreground: '#657B83', background: '#fdf6e3' })
      .map(renderControlCommand)).toEqual([
      `'refresh-client' '-r' "%0:\\033]10;rgb:6565/7b7b/8383\\033\\\\"`,
      `'refresh-client' '-r' "%0:\\033]11;rgb:fdfd/f6f6/e3e3\\033\\\\"`,
    ]);
  });

  it('lists the Panes of every Window of the Session, read as a Session', () => {
    const read = listSessionPanesCommand('0');
    expect(read.argv).toEqual(['list-panes', '-s', '-t', '0:', '-F', `${read.tag}#{pane_id}`]);
  });
});

describe('sending one named key into a Pane', () => {
  it('sends the name, so tmux picks the bytes for what the Pane is running', () => {
    // Measured on tmux 3.6: Up into a shell is `ESC [ A`, and Up into anything
    // that has turned DECCKM on is `ESC O A`. Only tmux knows which.
    expect(sendKeyCommand('%3', 'Up')).toEqual(['send-keys', '-t', '%3', 'Up']);
    expect(sendKeyCommand('%0', 'C-c')).toEqual(['send-keys', '-t', '%0', 'C-c']);
  });

  it('quotes the key like everything else, and tmux still reads it as one', () => {
    expect(renderControlCommand(sendKeyCommand('%3', 'M-.'))).toBe(
      "'send-keys' '-t' '%3' 'M-.'",
    );
  });
});

describe('typing into a Pane', () => {
  it('carries bytes as hex, one argument each', () => {
    expect(sendKeysCommand('%3', Uint8Array.of(0x68, 0x69, 0x0d))).toEqual([
      'send-keys',
      '-t',
      '%3',
      '-H',
      '68',
      '69',
      '0d',
    ]);
  });

  it('pads a byte below sixteen, which tmux would otherwise misread', () => {
    expect(sendKeysCommand('%0', Uint8Array.of(0x01, 0x1b))).toEqual([
      'send-keys',
      '-t',
      '%0',
      '-H',
      '01',
      '1b',
    ]);
  });

  it('carries a byte no keyboard has', () => {
    expect(sendKeysCommand('%0', Uint8Array.of(0xff))).toContain('ff');
  });
});

describe('reading a Pane back', () => {
  it('captures the visible screen with its colours and its spaces', () => {
    expect(capturePaneCommand('%2')).toEqual(['capture-pane', '-t', '%2', '-p', '-e', '-N']);
  });

  it('never joins wrapped lines, which would reflow the screen', () => {
    expect(capturePaneCommand('%2')).not.toContain('-J');
  });

  it('captures a range of the Scrollback by tmux’s own line numbers', () => {
    expect(captureScrollbackCommand('%2', -30, -1)).toEqual([
      'capture-pane',
      '-t',
      '%2',
      '-p',
      '-e',
      '-N',
      '-S',
      '-30',
      '-E',
      '-1',
    ]);
  });

  it('asks for what a resync and a scroll both need', () => {
    const format = paneStateCommand('%2').argv[4];
    expect(format).toContain('#{cursor_x}');
    expect(format).toContain('#{cursor_y}');
    expect(format).toContain('#{alternate_on}');
    expect(format).toContain('#{history_size}');
  });

  it('captures several Panes as several commands, with nothing between them', () => {
    // Control mode gives every command its own reply, so the captures arrive
    // already separated — no marker, and no shell to put one there.
    expect(capturePanesCommand(['work:0', 'work:1'])).toEqual([
      ['capture-pane', '-t', 'work:0', '-p'],
      ['capture-pane', '-t', 'work:1', '-p'],
    ]);
  });

  it('captures a preview without colour escapes, which a preview would show', () => {
    expect(capturePanesCommand(['work:0'])[0]).not.toContain('-e');
  });

  it('captures nothing for nobody', () => {
    expect(capturePanesCommand([])).toEqual([]);
  });
});

describe('capturePaneTextCommand', () => {
  it('reads a Pane as plain text with its wrapped lines joined', () => {
    expect(capturePaneTextCommand('%3')).toEqual(['capture-pane', '-t', '%3', '-p', '-J']);
  });
});

describe('the mark of a Pane', () => {
  it.each([
    ['7:100:200:zsh', { ack: 7, serverPid: 100, panePid: 200, program: 'zsh' }],
    [':100:200:zsh', { ack: null, serverPid: 100, panePid: 200, program: 'zsh' }],
    ['k7f2-7:100:200:zsh', { ack: null, serverPid: 100, panePid: 200, program: 'zsh' }],
    ['12:100:200:my:program', { ack: 12, serverPid: 100, panePid: 200, program: 'my:program' }],
    ['7:100:200:', { ack: 7, serverPid: 100, panePid: 200, program: '' }],
    [':100::', 'gone'],
    ['', null],
    [undefined, null],
    ["can't find pane: %4", null],
  ] as [string | undefined, unknown][])('reads %j', (line, mark) => {
    expect(parsePaneMark(line)).toEqual(mark);
  });
});

describe('a Host tmux that can refuse a late line', () => {
  it.each([
    ['3.0a', false],
    ['3.1c', false],
    ['3.2a', true],
    ['3.5a', true],
    ['3.8', true],
    ['next-3.9', true],
    ['master', true],
    ['openbsd-6.8', false],
    ['', false],
  ])('%j: %s', (version, guarded) => {
    expect(guardsLateLines(version)).toBe(guarded);
  });
});

describe('what the Log says of typed input', () => {
  const typed = Uint8Array.from(new TextEncoder().encode('hunter2'));

  it.each([true, false])('shows no typed byte of a Batch line (guarded: %s)', (guarded) => {
    const said = deliverCommands('%3', { bytes: typed }, 7 as Seq, '@muxify-in-k7f2', guarded)
      .map(describeCommand)
      .join(' ; ');
    expect(said).not.toMatch(/68 75|hunter/);
    expect(said).toContain('%3');
    expect(said).toContain('7');
  });

  it('shows no text of a paste, staged or pasted, and no buffer name in either branch', () => {
    const staged = stagePasteCommands('muxify-k-7-r', 'hunter2\n'.repeat(300)).map(describeCommand);
    expect(staged).toEqual(['set-buffer (2048 characters)', 'set-buffer (352 characters)']);
    const said = deliverCommands('%3', { buffer: 'muxify-k-7-r', submit: true }, 7 as Seq, '@muxify-in-k7f2', true)
      .map(describeCommand)
      .join(' ; ');
    expect(said).not.toMatch(/muxify-k-7-r|Enter|sleep/);
    expect(said).toContain('%3');
  });
});

describe('a split or New Window that runs one time', () => {
  const OPTIONS = { op: '@muxify-op-k7f2', pane: '@muxify-op-pane-k7f2' };
  const READ = '<op>#{pid}:#{@muxify-op-k7f2}:#{@muxify-op-pane-k7f2}:#{pane_id}';

  it('runs the verb and records its Op and Pane only while the Session is below the Op, then reads both', () => {
    const line = verbCommands('$3', { kind: 'split', direction: 'right' }, 4 as Op, OPTIONS, true);
    expect(line).toEqual([
      [
        'if-shell',
        '-F',
        '-t',
        '$3:',
        '#{e|<:#{e|+:0,#{@muxify-op-k7f2}},4}',
        "'split-window' '-h' '-t' '$3:' ; 'set-option' '-t' '$3:' '@muxify-op-k7f2' '4' ; " +
          "'set-option' '-F' '-t' '$3:' '@muxify-op-pane-k7f2' '#{pane_id}'",
      ],
      ['display-message', '-p', '-t', '$3:', READ],
    ]);
  });

  it('runs the verb with no guard on a tmux below 3.2, and reads the active Pane after it', () => {
    expect(verbCommands('0', { kind: 'new-window' }, 1 as Op, OPTIONS, false)).toEqual([
      ['new-window', '-a', '-t', '0:'],
      ['set-option', '-t', '0:', '@muxify-op-k7f2', '1'],
      ['display-message', '-p', '-t', '0:', READ],
    ]);
  });

  it.each([
    ['812:4:%7:%7', { held: 4, serverPid: 812, madePane: '%7', activePane: '%7' }],
    ['812:4:%7:%9', { held: 4, serverPid: 812, madePane: '%7', activePane: '%9' }],
    ['812:::%9', { held: 0, serverPid: 812, madePane: null, activePane: '%9' }],
    ['812:4::%9', { held: 4, serverPid: 812, madePane: null, activePane: '%9' }],
    ['812:::', { held: 0, serverPid: 812, madePane: null, activePane: null }],
    ['812:4', null],
    ['812:4:%7', null],
    [':4:%7:%7', null],
    ['812:4:x:%7', null],
    ['4', null],
    ['', null],
    [undefined, null],
  ])('reads %j as %j', (line, op) => {
    expect(parseSessionOp(line)).toEqual(op);
  });
});
