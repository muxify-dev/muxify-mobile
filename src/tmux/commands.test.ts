import { attachSessionCommand, listSessionsCommand, shellQuote } from './commands';

describe('shellQuote', () => {
  it('quotes a plain word', () => {
    expect(shellQuote('main')).toBe("'main'");
  });

  it('quotes a name containing spaces', () => {
    expect(shellQuote('my session')).toBe("'my session'");
  });

  it('escapes an embedded single quote so the command cannot be broken out of', () => {
    // The classic injection shape: a name that would otherwise close the quote.
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
    expect(attachSessionCommand("'; id; '")).toBe(
      "tmux attach-session -t ''\\''; id; '\\'''",
    );
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
