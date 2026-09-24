import {
  capturePaneCommand,
  captureScrollbackCommand,
  capturePanesCommand,
  controlAttachCommand,
  createSessionCommand,
  listPanesCommand,
  listSessionsCommand,
  listWindowsCommand,
  newWindowCommand,
  paneStateCommand,
  renderControlCommand,
  renderExecCommand,
  resizeClientCommand,
  selectPaneCommand,
  selectWindowCommand,
  sendKeyCommand,
  sendKeysCommand,
  shellQuote,
  splitWindowCommand,
  switchSessionCommand,
  tmuxQuote,
  zoomPaneCommand,
} from './commands';

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
    expect(renderExecCommand(['list-sessions'])).toBe("tmux 'list-sessions'");
    expect(renderExecCommand(['list-sessions'], '/opt/homebrew/bin/tmux')).toBe(
      "'/opt/homebrew/bin/tmux' 'list-sessions'",
    );
  });
});

describe('attaching', () => {
  it('runs tmux in control mode, attaching to a Session that exists', () => {
    expect(controlAttachCommand('work')).toBe("tmux '-C' 'attach-session' '-t' 'work'");
  });

  it('never creates a Session on the way in', () => {
    expect(controlAttachCommand('work')).not.toContain('new-session');
  });
});

describe('reading what is there', () => {
  it('asks for the fields a Session picker shows', () => {
    expect(listSessionsCommand()).toEqual([
      'list-sessions',
      '-F',
      '#{session_name}\t#{session_windows}',
    ]);
  });

  it('never asks whether anyone is attached', () => {
    // That was a warning that joining would shrink somebody's Window, which a
    // control client cannot do. See ADR 0006.
    expect(listSessionsCommand().join(' ')).not.toContain('session_attached');
  });

  it('puts the Session name where a tab in it cannot shift the count', () => {
    const fields = listSessionsCommand()[2].split('\t');
    expect(fields[fields.length - 2]).toBe('#{session_name}');
  });

  it('asks a Window for its layout rather than its Panes’ coordinates', () => {
    const format = listPanesCommand('work', 1)[4];
    expect(format).toContain('#{window_layout}');
    expect(format).not.toContain('#{pane_left}');
  });

  it('addresses a Window as session:index', () => {
    expect(listWindowsCommand('work')).toEqual([
      'list-windows',
      '-t',
      'work',
      expect.any(String),
      expect.any(String),
    ]);
    expect(listPanesCommand('work', 3)[2]).toBe('work:3');
  });
});

describe('moving around', () => {
  it('selects a Window and a Pane by target', () => {
    expect(selectWindowCommand('work', 2)).toEqual(['select-window', '-t', 'work:2']);
    // `-Z` and not by accident: a plain select-pane unzooms a zoomed Window,
    // and the phone then draws the split for the two round trips it takes to
    // put the zoom back. See selectPaneCommand.
    expect(selectPaneCommand('work', 2, 1)).toEqual(['select-pane', '-Z', '-t', 'work:2.1']);
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
    const format = paneStateCommand('%2')[4];
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
