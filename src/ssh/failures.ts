import type { DisconnectReason } from '@/tmux/disconnect-reason';

export class MissingCredentialError extends Error {
  constructor() {
    super('No credential is stored for this Host. Edit it and enter one.');
    this.name = 'MissingCredentialError';
  }
}

/**
 * A read or write that could not use the Host at all. The Connections have
 * recorded `reason` as the Host's Host Problem, which the screen shows in
 * its one place, so a reader that gets this draws no error of its own.
 */
export class HostProblem extends Error {
  constructor(readonly reason: DisconnectReason) {
    super(reason.detail);
    this.name = 'HostProblem';
  }
}
