/**
 * Validation for the Host form.
 *
 * A HostDraft is the in-progress edit buffer behind the add/edit screen — every
 * field is a string because every field is a text input. Validation runs before
 * any Connection is attempted, so a typo produces an immediate, specific answer
 * instead of a confusing network error.
 *
 * The draft deliberately carries both Host fields and Identity material in one
 * flat shape, because one form collects both. It is *not* a Host: on save it is
 * split into a Host record and an Identity, which the glossary keeps separate so
 * one Identity can serve several Hosts. Nothing downstream should persist a
 * draft as-is.
 *
 * Pure by design: no seam, no transport, no storage. Called directly by tests.
 */

export type IdentityKind = 'password' | 'privateKey';

export interface HostDraft {
  displayName: string;
  address: string;
  /** Text-field contents, not a number — "22.5" and "ssh" must both be caught. */
  port: string;
  username: string;
  /** Optional. Absolute path to tmux for Hosts where it is not on `PATH`. */
  tmuxExecutablePath: string;
  identityKind: IdentityKind;
  password: string;
  privateKeyPem: string;
}

export type HostDraftField = keyof HostDraft;

export interface HostDraftValidation {
  ok: boolean;
  errors: Partial<Record<HostDraftField, string>>;
}

const MIN_PORT = 1;
const MAX_PORT = 65535;

/** Matches a string that is entirely digits — rejects signs and decimal points. */
const DIGITS_ONLY = /^\d+$/;
const CONTAINS_WHITESPACE = /\s/;
const CONTAINS_CONTROL_CHARACTER = new RegExp('[\u0000-\u001f\u007f]');

export function emptyHostDraft(): HostDraft {
  return {
    displayName: '',
    address: '',
    port: '22',
    username: '',
    tmuxExecutablePath: '',
    identityKind: 'password',
    password: '',
    privateKeyPem: '',
  };
}

export interface ValidateOptions {
  /**
   * Whether a credential must be present. False when editing: the keychain
   * already holds one, and making the user retype a private key to fix a typo
   * in an address is how people end up not fixing the typo.
   */
  requireCredential?: boolean;
}

export function validateHostDraft(
  draft: HostDraft,
  { requireCredential = true }: ValidateOptions = {},
): HostDraftValidation {
  const errors: Partial<Record<HostDraftField, string>> = {};

  if (draft.displayName.trim() === '') {
    errors.displayName = 'Give this Host a name.';
  }

  const address = draft.address.trim();
  if (address === '') {
    errors.address = 'Enter an address or hostname.';
  } else if (CONTAINS_WHITESPACE.test(address)) {
    errors.address = 'An address cannot contain spaces.';
  }

  const port = draft.port.trim();
  if (port === '') {
    errors.port = 'Enter a port.';
  } else if (!DIGITS_ONLY.test(port)) {
    errors.port = 'A port must be a whole number.';
  } else {
    const parsed = Number(port);
    if (parsed < MIN_PORT || parsed > MAX_PORT) {
      errors.port = `A port must be between ${MIN_PORT} and ${MAX_PORT}.`;
    }
  }

  if (draft.username.trim() === '') {
    errors.username = 'Enter the user to connect as.';
  }

  const tmuxPath = draft.tmuxExecutablePath.trim();
  if (tmuxPath !== '') {
    if (!tmuxPath.startsWith('/')) {
      errors.tmuxExecutablePath = 'A tmux path must be absolute, starting with "/".';
    } else if (CONTAINS_CONTROL_CHARACTER.test(tmuxPath)) {
      errors.tmuxExecutablePath = 'A tmux path cannot contain control characters.';
    }
  }

  const credentialGiven =
    draft.identityKind === 'password' ? draft.password !== '' : draft.privateKeyPem !== '';

  if (!requireCredential && !credentialGiven) {
    // Nothing typed on an edit means "keep what is stored".
  } else if (draft.identityKind === 'password') {
    if (draft.password === '') {
      errors.password = 'Enter a password.';
    }
  } else {
    const keyError = validatePrivateKey(draft.privateKeyPem);
    if (keyError) {
      errors.privateKeyPem = keyError;
    }
  }

  return { ok: Object.keys(errors).length === 0, errors };
}

function validatePrivateKey(pem: string): string | undefined {
  const key = pem.trim();

  if (key === '') {
    return 'Paste a private key.';
  }

  if (!key.includes('-----BEGIN') || !key.includes('-----END')) {
    return 'This does not look like a private key. Paste the whole PEM block.';
  }

  // Passphrase-protected keys are out of scope, so reject them with a clear
  // message rather than letting them fail opaquely at the transport. This
  // catches the classic PEM headers; an encrypted OpenSSH-format key hides its
  // cipher inside the base64 body and is only detectable by parsing it, so
  // those still reach the transport and fail there.
  const isEncrypted =
    (key.includes('Proc-Type:') && key.includes('ENCRYPTED')) || key.includes('DEK-Info:');
  if (isEncrypted) {
    return 'Passphrase-protected keys are not supported yet.';
  }

  return undefined;
}
