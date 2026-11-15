import { useEffect, useRef, useState } from 'react';

import { check, ended, IDLE, reached, send, type HostWrite, type HostWriteEnd, type HostWriteStep } from '@/domain/host-write';
import { describeConnectionFailure } from '@/ssh/failures';
import { deviceHostStore } from '@/storage/device-store';
import type { Host } from '@/storage/records';

/** What a write's code gets while it runs. */
export interface HostWriteRun {
  host: Host;
  /** Moves the write on. `sending` must come before the first command that changes the Host. */
  step(next: Exclude<HostWriteStep, 'connecting' | 'checking'>): void;
  /** Ends the run as failed: nothing changed, or the Host said no. `fields` puts reasons under their fields. */
  refuse(reason: string, fields?: Readonly<Record<string, string>>): never;
}

export interface HostWrites {
  state(target: string): HostWrite;
  /** The saved Host's name, once it is read. */
  hostName: string | null;
  /**
   * Sends one write for `target`. Ignored while a write for it runs or is
   * unsure. Resolves to what `attempt` returned, or undefined when the write
   * did not end done or the screen is gone.
   */
  send<T>(target: string, attempt: (run: HostWriteRun) => Promise<T>): Promise<T | undefined>;
  /** Finds out whether an unsure write reached the Host. `probe` refuses when it did not. */
  check<T>(target: string, probe: (run: HostWriteRun) => Promise<T>): Promise<T | undefined>;
  /**
   * Sends one write for a target that reports its end once, as a Topic card
   * does with an alert and a new read of the Listing. Resolves to how it
   * ended, and leaves the target idle; undefined when ignored or the screen is gone.
   */
  sendAndReport(target: string, attempt: (run: HostWriteRun) => Promise<unknown>): Promise<HostWrite | undefined>;
}

class Refusal extends Error {
  constructor(readonly reason: string, readonly fields?: Readonly<Record<string, string>>) {
    super(reason);
  }
}

/**
 * The runner of every Host Write on one screen, for one Host. It owns the
 * state of each target, ignores a second tap, stops at an unmount, and turns
 * a break into failed or unsure from the step it happened in.
 */
export function useHostWrites(hostId: string, now: () => number = Date.now): HostWrites {
  const [states, setStates] = useState<ReadonlyMap<string, HostWrite>>(new Map());
  const current = useRef(states);
  const present = useRef(true);
  const [hostName, setHostName] = useState<string | null>(null);
  useEffect(() => {
    present.current = true;
    return () => { present.current = false; };
  }, []);
  useEffect(() => {
    void loadHost(hostId).then((host) => { if (present.current && host) setHostName(host.displayName); });
  }, [hostId]);

  const move = (target: string, next: HostWrite) => {
    const all = new Map(current.current);
    if (next.kind === 'idle') all.delete(target);
    else all.set(target, next);
    current.current = all;
    if (present.current) setStates(all);
  };

  const run = async <T,>(
    target: string,
    begin: HostWrite | null,
    attempt: (run: HostWriteRun) => Promise<T>,
  ): Promise<{ end: HostWrite; value?: T } | undefined> => {
    if (begin === null) return undefined;
    move(target, begin);
    const at = () => current.current.get(target) ?? IDLE;
    let end: HostWriteEnd;
    let value: T | undefined;
    try {
      const host = await loadHost(hostId);
      if (!host) throw new Refusal('This Host is no longer saved.');
      value = await attempt({
        host,
        step: (next) => move(target, reached(at(), next)),
        refuse: (reason, fields) => { throw new Refusal(reason, fields); },
      });
      end = { kind: 'done' };
    } catch (error) {
      end = error instanceof Refusal
        ? { kind: 'refused', reason: error.reason, fields: error.fields }
        : { kind: 'threw', reason: describeConnectionFailure(error) };
    }
    const last = ended(at(), end);
    move(target, last);
    return present.current ? { end: last, value } : undefined;
  };

  const valueOf = <T,>(result: { end: HostWrite; value?: T } | undefined) => (result?.end.kind === 'idle' ? result.value : undefined);

  return {
    state: (target) => states.get(target) ?? IDLE,
    hostName,
    send: async (target, attempt) => valueOf(await run(target, send(current.current.get(target) ?? IDLE, now()), attempt)),
    check: async (target, probe) => valueOf(await run(target, check(current.current.get(target) ?? IDLE, now()), probe)),
    sendAndReport: async (target, attempt) => {
      const result = await run(target, send(current.current.get(target) ?? IDLE, now()), attempt);
      if (result) move(target, IDLE);
      return result?.end;
    },
  };
}

const ONE = 'one';

/** The runner for a sheet, which has one write. */
export function useHostWrite(hostId: string) {
  const writes = useHostWrites(hostId);
  return {
    write: writes.state(ONE),
    hostName: writes.hostName,
    send: <T,>(attempt: (run: HostWriteRun) => Promise<T>) => writes.send(ONE, attempt),
    check: <T,>(probe: (run: HostWriteRun) => Promise<T>) => writes.check(ONE, probe),
  };
}

async function loadHost(hostId: string): Promise<Host | undefined> {
  return (await deviceHostStore().load()).hosts.find((candidate) => candidate.id === hostId);
}
