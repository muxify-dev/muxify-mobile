import {
  attachSessionCommand,
  resizeClientCommand,
  capturePanesCommand,
  newWindowCommand,
  splitWindowCommand,
  zoomPaneCommand,
  listClientsCommand,
  redrawClientCommand,
  listPanesCommand,
  listSessionsCommand,
  listWindowsCommand,
  selectPaneCommand,
  selectWindowCommand,
  readWindowSizingCommand,
  setWindowSizingCommand,
  shellQuote,
  switchSessionCommand,
} from './commands';

describe('shellQuote', () => {
  it('quotes a plain word', () => {
    expect(shellQuote('main')).toBe("'main'");
  });

  it('quotes a name containing spaces', () => {
    expect(shellQuote('my session')).toBe("'my session'");
  });

  it('escapes an embedded single quote so the command cannot be broken out of', () => {
    expect(shellQuote("it's")).toBe("'it'\\''s'");
  });

  it('neutralises a command-substitution attempt', () => {
    expect(shellQuote('$(rm -rf /)')).toBe("'$(rm -rf /)'");
  });

  it('neutralises a semicolon chain', () => {
    expect(shellQuote('a; rm -rf /')).toBe("'a; rm -rf /'");
  });

  it('quotes an empty string', () => {
    expect(shellQuote('')).toBe("''");
  });
});

describe('listSessionsCommand', () => {
  it('asks tmux for one Session name per line', () => {
    expect(listSessionsCommand()).toBe(
      "tmux list-sessions -F '#{session_name}\t#{session_windows}'",
    );
  });

  it('uses an explicit tmux path when the Host provides one', () => {
    expect(listSessionsCommand('/usr/bin/tmux')).toBe(
      "'/usr/bin/tmux' list-sessions -F '#{session_name}\t#{session_windows}'",
    );
  });
});

describe('attachSessionCommand', () => {
  it('attaches to a named Session', () => {
    expect(attachSessionCommand('0')).toBe("tmux attach-session -t '0'");
  });

  it('never creates a Session, only attaches', () => {
    // Muxify is attach-only; `new-session -A` would silently create one.
    expect(attachSessionCommand('main')).not.toContain('new-session');
  });

  it('quotes a Session name containing a space', () => {
    expect(attachSessionCommand('my work')).toBe("tmux attach-session -t 'my work'");
  });

  it('escapes a Session name that tries to break out of the command', () => {
    expect(attachSessionCommand("'; id; '")).toBe("tmux attach-session -t ''\\''; id; '\\'''");
  });

  it('uses an explicit tmux path when the Host provides one', () => {
    expect(attachSessionCommand('0', '/usr/bin/tmux')).toBe(
      "'/usr/bin/tmux' attach-session -t '0'",
    );
  });

  it('quotes a tmux path containing a space', () => {
    expect(attachSessionCommand('0', '/opt/my tools/tmux')).toBe(
      "'/opt/my tools/tmux' attach-session -t '0'",
    );
  });
});

describe('listWindowsCommand', () => {
  it('asks for what a Window preview needs, tab separated', () => {
    expect(listWindowsCommand('main')).toBe(
      "tmux list-windows -t 'main' -F '#{window_index}\t#{window_name}\t#{window_active}" +
        "\t#{window_panes}\t#{window_zoomed_flag}\t#{pane_current_command}'",
    );
  });

  it('quotes a Session name containing a space', () => {
    expect(listWindowsCommand('my work')).toContain("-t 'my work'");
  });

  it('uses an explicit tmux path when the Host provides one', () => {
    expect(listWindowsCommand('main', '/usr/bin/tmux').startsWith("'/usr/bin/tmux' list-windows")).toBe(
      true,
    );
  });
});

describe('listPanesCommand', () => {
  it('targets a specific Window inside a Session', () => {
    expect(listPanesCommand('main', 2)).toBe(
      "tmux list-panes -t 'main:2' -F '#{pane_index}\t#{pane_id}\t#{pane_current_command}" +
        "\t#{pane_active}\t#{pane_current_path}\t#{window_layout}'",
    );
  });

  it('quotes the combined target so a Session name cannot break it', () => {
    expect(listPanesCommand("a'b", 0)).toContain("-t 'a'\\''b:0'");
  });
});

describe('selectWindowCommand', () => {
  it('selects a Window by index within a Session', () => {
    expect(selectWindowCommand('main', 3)).toBe("tmux select-window -t 'main:3'");
  });

  it('quotes a Session name containing a space', () => {
    expect(selectWindowCommand('my work', 1)).toBe("tmux select-window -t 'my work:1'");
  });
});

describe('selectPaneCommand', () => {
  it('selects a Pane within a Window within a Session', () => {
    expect(selectPaneCommand('main', 1, 2)).toBe("tmux select-pane -t 'main:1.2'");
  });
});

describe('switchSessionCommand', () => {
  it('switches the attached client to another Session', () => {
    expect(switchSessionCommand('other')).toBe("tmux switch-client -t 'other'");
  });

  it('escapes a Session name that tries to break out', () => {
    expect(switchSessionCommand("'; id; '")).toBe("tmux switch-client -t ''\\''; id; '\\'''");
  });
});

describe('window sizing', () => {
  it('reads how the Session sizes its Windows, so it can be put back', () => {
    expect(readWindowSizingCommand('main')).toBe("tmux show-options -t 'main' -v window-size");
  });

  it('keeps the Window no bigger than the Surface, which is what stops the padding', () => {
    expect(setWindowSizingCommand('main', 'smallest')).toBe(
      "tmux set-option -t 'main' window-size 'smallest'",
    );
  });

  it('quotes the Session name so it cannot break out of the command', () => {
    expect(setWindowSizingCommand("'; id; '", 'smallest')).toBe(
      "tmux set-option -t ''\\''; id; '\\''' window-size 'smallest'",
    );
  });

  it('quotes the value, which comes back off the Host', () => {
    expect(setWindowSizingCommand('main', '; id; ')).toBe(
      "tmux set-option -t 'main' window-size '; id; '",
    );
  });

  it('honours the Host tmux path', () => {
    expect(setWindowSizingCommand('main', 'latest', '/usr/bin/tmux')).toBe(
      "'/usr/bin/tmux' set-option -t 'main' window-size 'latest'",
    );
  });
});

describe('listClientsCommand', () => {
  it('asks for each Client of a Session with its creation time and tty', () => {
    expect(listClientsCommand('main')).toBe(
      "tmux list-clients -t 'main' -F '#{client_created}\t#{client_tty}'",
    );
  });

  it('quotes a Session name containing a space', () => {
    expect(listClientsCommand('my work')).toContain("-t 'my work'");
  });
});

describe('redrawClientCommand', () => {
  it('redraws one Client, addressed by its tty', () => {
    expect(redrawClientCommand('/dev/pts/3')).toBe("tmux refresh-client -t '/dev/pts/3'");
  });

  it('falls back to whichever Client tmux considers best', () => {
    expect(redrawClientCommand()).toBe('tmux refresh-client');
  });

  it('never asks tmux to resize the Client, which only control mode allows', () => {
    // `refresh-client -C` is control-mode only (ADR 0001), and silently does
    // nothing for an attached Client — verified against tmux 3.6.
    expect(redrawClientCommand('/dev/pts/3')).not.toContain('-C');
  });

  it('honours the Host tmux path', () => {
    expect(redrawClientCommand('/dev/pts/3', '/usr/bin/tmux')).toBe(
      "'/usr/bin/tmux' refresh-client -t '/dev/pts/3'",
    );
  });
});

describe('capturePanesCommand', () => {
  it('captures what one Pane is showing', () => {
    expect(capturePanesCommand(['main:1.0'])).toBe("tmux capture-pane -t 'main:1.0' -p");
  });

  it('chains several captures into one round trip, separated by a marker', () => {
    // A picker that takes a round trip per Pane is a picker nobody opens.
    expect(capturePanesCommand(['a:0', 'a:1'])).toBe(
      "tmux capture-pane -t 'a:0' -p ; echo '@@muxify@@' ; tmux capture-pane -t 'a:1' -p",
    );
  });

  it('is empty for no targets, so nothing is sent', () => {
    expect(capturePanesCommand([])).toBe('');
  });

  it('quotes a target that tries to break out', () => {
    expect(capturePanesCommand(["'; id; '"])).toContain("-t ''\\''; id; '\\'''");
  });
});

describe('zoomPaneCommand', () => {
  it('toggles zoom on the Session\'s active Pane', () => {
    expect(zoomPaneCommand('main')).toBe("tmux resize-pane -Z -t 'main:'");
  });
});

describe('ambiguous targets', () => {
  // tmux names its first Session `0`, and a bare `-t '0'` is read as Pane 0 —
  // so zoom and split both hit the first Pane and select it, whatever the user
  // was looking at. The trailing colon forces the Session reading.
  it('aims zoom at the Session, not at the Pane its name looks like', () => {
    expect(zoomPaneCommand('0')).toBe("tmux resize-pane -Z -t '0:'");
  });

  it('aims a split at the Session, not at the Pane its name looks like', () => {
    expect(splitWindowCommand('0', 'right')).toBe("tmux split-window -h -t '0:'");
  });

  it('aims a new Window at the Session too', () => {
    expect(newWindowCommand('0')).toBe("tmux new-window -a -t '0:'");
  });
});

describe('splitWindowCommand', () => {
  it('splits beside the current Pane', () => {
    expect(splitWindowCommand('main', 'right')).toBe("tmux split-window -h -t 'main:'");
  });

  it('splits below the current Pane', () => {
    expect(splitWindowCommand('main', 'down')).toBe("tmux split-window -v -t 'main:'");
  });
});

describe('newWindowCommand', () => {
  it('adds a Window after the current one', () => {
    expect(newWindowCommand('main')).toBe("tmux new-window -a -t 'main:'");
  });
});

describe('resizeClientCommand', () => {
  it('sets the size of the tty tmux is attached to', () => {
    expect(resizeClientCommand('/dev/pts/3', 38, 19)).toBe(
      "stty -F '/dev/pts/3' rows 19 cols 38 2>/dev/null || stty -f '/dev/pts/3' rows 19 cols 38",
    );
  });

  it('falls back to the BSD spelling, since the Host may be either', () => {
    expect(resizeClientCommand('/dev/ttys001', 80, 24)).toContain('stty -f');
  });

  it('never asks for a zero or negative size', () => {
    expect(resizeClientCommand('/dev/pts/3', 0, -4)).toContain('rows 1 cols 1');
  });

  it('floors fractional sizes', () => {
    expect(resizeClientCommand('/dev/pts/3', 38.9, 19.2)).toContain('rows 19 cols 38');
  });

  it('quotes a tty that tries to break out of the command', () => {
    expect(resizeClientCommand("'; id; '", 38, 19)).toContain("''\\''; id; '\\'''");
  });
});
