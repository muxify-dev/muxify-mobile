import { emptyHostDraft, validateHostDraft, type HostDraft } from './validate-host-draft';

const draft = (overrides: Partial<HostDraft> = {}): HostDraft => ({
  ...emptyHostDraft(),
  displayName: 'Mac mini',
  address: 'server.local',
  port: '22',
  username: 'evgeny',
  identityKind: 'password',
  password: 'hunter2',
  ...overrides,
});

describe('validateHostDraft', () => {
  it('accepts a complete password draft', () => {
    expect(validateHostDraft(draft())).toEqual({ ok: true, errors: {} });
  });

  it('accepts a complete private key draft', () => {
    const result = validateHostDraft(
      draft({
        identityKind: 'privateKey',
        password: '',
        privateKeyPem: '-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----',
      }),
    );
    expect(result.ok).toBe(true);
  });

  describe('display name', () => {
    it('rejects an empty display name', () => {
      expect(validateHostDraft(draft({ displayName: '' })).errors.displayName).toBeDefined();
    });

    it('rejects a display name of only whitespace', () => {
      expect(validateHostDraft(draft({ displayName: '   ' })).errors.displayName).toBeDefined();
    });
  });

  describe('address', () => {
    it('rejects an empty address', () => {
      expect(validateHostDraft(draft({ address: '' })).errors.address).toBeDefined();
    });

    it('rejects an address containing whitespace', () => {
      expect(validateHostDraft(draft({ address: 'my server' })).errors.address).toBeDefined();
    });

    it('accepts a hostname', () => {
      expect(validateHostDraft(draft({ address: 'box.example.com' })).ok).toBe(true);
    });

    it('accepts an IPv4 address', () => {
      expect(validateHostDraft(draft({ address: '100.64.0.10' })).ok).toBe(true);
    });
  });

  describe('port', () => {
    it('accepts the lowest valid port', () => {
      expect(validateHostDraft(draft({ port: '1' })).ok).toBe(true);
    });

    it('accepts the highest valid port', () => {
      expect(validateHostDraft(draft({ port: '65535' })).ok).toBe(true);
    });

    it('rejects port zero', () => {
      expect(validateHostDraft(draft({ port: '0' })).errors.port).toBeDefined();
    });

    it('rejects a port above the valid range', () => {
      expect(validateHostDraft(draft({ port: '65536' })).errors.port).toBeDefined();
    });

    it('rejects a negative port', () => {
      expect(validateHostDraft(draft({ port: '-1' })).errors.port).toBeDefined();
    });

    it('rejects a non-numeric port', () => {
      expect(validateHostDraft(draft({ port: 'ssh' })).errors.port).toBeDefined();
    });

    it('rejects a fractional port', () => {
      expect(validateHostDraft(draft({ port: '22.5' })).errors.port).toBeDefined();
    });

    it('rejects an empty port rather than assuming a default', () => {
      expect(validateHostDraft(draft({ port: '' })).errors.port).toBeDefined();
    });
  });

  describe('username', () => {
    it('rejects an empty username', () => {
      expect(validateHostDraft(draft({ username: '' })).errors.username).toBeDefined();
    });
  });

  describe('tmux executable path', () => {
    it('accepts an omitted path, since it is optional', () => {
      expect(validateHostDraft(draft({ tmuxExecutablePath: '' })).ok).toBe(true);
    });

    it('accepts an absolute path', () => {
      expect(validateHostDraft(draft({ tmuxExecutablePath: '/opt/homebrew/bin/tmux' })).ok).toBe(
        true,
      );
    });

    it('rejects a relative path', () => {
      expect(
        validateHostDraft(draft({ tmuxExecutablePath: 'bin/tmux' })).errors.tmuxExecutablePath,
      ).toBeDefined();
    });

    it('rejects a bare binary name', () => {
      expect(
        validateHostDraft(draft({ tmuxExecutablePath: 'tmux' })).errors.tmuxExecutablePath,
      ).toBeDefined();
    });

    it('rejects a path containing a control character', () => {
      const path = `/usr/bin/${String.fromCharCode(10)}tmux`;
      expect(validateHostDraft(draft({ tmuxExecutablePath: path })).errors.tmuxExecutablePath)
        .toBeDefined();
    });
  });

  describe('identity material', () => {
    it('rejects a password draft with no password', () => {
      expect(
        validateHostDraft(draft({ identityKind: 'password', password: '' })).errors.password,
      ).toBeDefined();
    });

    it('rejects a private key draft with no key', () => {
      expect(
        validateHostDraft(draft({ identityKind: 'privateKey', password: '', privateKeyPem: '' }))
          .errors.privateKeyPem,
      ).toBeDefined();
    });

    it('rejects a private key that is not a PEM block', () => {
      expect(
        validateHostDraft(
          draft({ identityKind: 'privateKey', password: '', privateKeyPem: 'not a key' }),
        ).errors.privateKeyPem,
      ).toBeDefined();
    });

    it('does not require a password when authenticating by key', () => {
      const result = validateHostDraft(
        draft({
          identityKind: 'privateKey',
          password: '',
          privateKeyPem: '-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----',
        }),
      );
      expect(result.errors.password).toBeUndefined();
    });

    it('rejects a passphrase-protected key, which is out of scope', () => {
      const encrypted = [
        '-----BEGIN RSA PRIVATE KEY-----',
        'Proc-Type: 4,ENCRYPTED',
        'DEK-Info: AES-128-CBC,0123456789ABCDEF',
        '',
        'abc',
        '-----END RSA PRIVATE KEY-----',
      ].join('\n');
      expect(
        validateHostDraft(
          draft({ identityKind: 'privateKey', password: '', privateKeyPem: encrypted }),
        ).errors.privateKeyPem,
      ).toBeDefined();
    });
  });

  it('reports every invalid field at once rather than stopping at the first', () => {
    const result = validateHostDraft(
      draft({ displayName: '', address: '', port: 'nope', username: '' }),
    );
    expect(Object.keys(result.errors).sort()).toEqual(['address', 'displayName', 'port', 'username']);
  });

  it('trims surrounding whitespace before judging a field', () => {
    expect(validateHostDraft(draft({ displayName: '  Mac mini  ' })).ok).toBe(true);
  });
});

describe('editing an existing Host', () => {
  it('accepts a draft with no credential, because the keychain already has one', () => {
    // Making someone retype a private key to fix a typo in an address is how
    // the typo stays unfixed.
    const draft = {
      ...emptyHostDraft(),
      displayName: 'Build box',
      address: '10.0.0.4',
      username: 'evgeny',
      password: '',
    };

    expect(validateHostDraft(draft, { requireCredential: false }).ok).toBe(true);
  });

  it('still rejects a private key that was typed but is not a key', () => {
    const draft = {
      ...emptyHostDraft(),
      displayName: 'Build box',
      address: '10.0.0.4',
      username: 'evgeny',
      identityKind: 'privateKey' as const,
      privateKeyPem: 'not a key',
    };

    expect(validateHostDraft(draft, { requireCredential: false }).ok).toBe(false);
  });

  it('demands a credential when adding, which is the default', () => {
    const draft = {
      ...emptyHostDraft(),
      displayName: 'Build box',
      address: '10.0.0.4',
      username: 'evgeny',
    };

    expect(validateHostDraft(draft).errors.password).toBeDefined();
  });
});
