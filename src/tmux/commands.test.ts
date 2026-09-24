import {
  attachSessionCommand,
  listClientsCommand,
  redrawClientCommand,
  listPanesCommand,
  listSessionsCommand,
  listWindowsCommand,
  selectPaneCommand,
  selectWindowCommand,
  manualWindowSizeCommand,
  resizeWindowCommand,
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
    expect(listSessionsCommand()).toBe("tmux list-sessions -F '#{session_name}'");
  });

  it('uses an explicit tmux path when the Host provides one', () => {
    expect(listSessionsCommand('/usr/bin/tmux')).toBe(
      "'/usr/bin/tmux' list-sessions -F '#{session_name}'",
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
  it('asks for index, name and active flag per Window, tab separated', () => {
    expect(listWindowsCommand('main')).toBe(
      "tmux list-windows -t 'main' -F '#{window_index}\t#{window_name}\t#{window_active}'",
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
      "tmux list-panes -t 'main:2' -F '#{pane_index}\t#{pane_current_command}\t#{pane_active}'",
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
  it('switches the Session to manual window sizing', () => {
    expect(manualWindowSizeCommand('main')).toBe("tmux set-option -t 'main' window-size manual");
  });

  it('resizes the Window to an explicit grid', () => {
    expect(resizeWindowCommand('main', 38, 14)).toBe("tmux resize-window -t 'main' -x 38 -y 14");
  });

  it('never asks for a zero or negative size, which tmux rejects', () => {
    expect(resizeWindowCommand('main', 0, -5)).toBe("tmux resize-window -t 'main' -x 1 -y 1");
  });

  it('floors fractional sizes', () => {
    expect(resizeWindowCommand('main', 38.7, 14.2)).toBe("tmux resize-window -t 'main' -x 38 -y 14");
  });

  it('quotes the Session name so it cannot break out of the command', () => {
    expect(resizeWindowCommand("'; id; '", 10, 10)).toBe(
      "tmux resize-window -t ''\\''; id; '\\''' -x 10 -y 10",
    );
  });

  it('honours the Host tmux path', () => {
    expect(resizeWindowCommand('main', 38, 14, '/usr/bin/tmux')).toBe(
      "'/usr/bin/tmux' resize-window -t 'main' -x 38 -y 14",
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
