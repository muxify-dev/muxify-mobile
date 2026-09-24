export class MissingCredentialError extends Error {
  constructor() {
    super('No credential is stored for this Host. Edit it and enter one.');
    this.name = 'MissingCredentialError';
  }
}

/**
 * Turns a connection failure into something worth reading.
 *
 * Authentication failing and a machine being unreachable are different problems
 * with different fixes, and a single "could not connect" hides which one it is.
 * The library gives each a code, so they are kept apart here.
 */
export function describeConnectionFailure(error: unknown): string {
  if (error instanceof MissingCredentialError) return error.message;

  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: unknown }).code)
      : '';
  const detail = error instanceof Error ? error.message : String(error);

  switch (code) {
    case 'AUTH_FAILED':
      return 'The Host refused those credentials. Check the user and password or key.';
    case 'HOST_KEY_REJECTED':
      return 'The Host key was rejected.';
    case 'TIMEOUT':
      return 'The Host did not answer in time. Check the address and that it is reachable.';
    case 'CANCELLED':
      return 'The connection was cancelled.';
    default:
      return detail === '' ? 'Could not reach the Host.' : detail;
  }
}
