import React, { useEffect } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { createTestClock } from '@/lib/test-clock';
import { createHostConnections, type Dialed, type HostConnections } from '@/ssh/host-connections';
import type { Host } from '@/storage/records';

import { useHostReading } from './use-host-reading';

const host = { id: 'h1', displayName: 'mac', tmuxExecutablePath: 'tmux' } as Host;

let mockDown = true;
const mockConnections: HostConnections = createHostConnections({
  clock: createTestClock(),
  store: { rememberFingerprint: () => Promise.resolve() },
  dial: (): Promise<Dialed> => {
    if (mockDown) return Promise.reject(new Error('Connection refused (os error 61)'));
    return Promise.resolve({
      transport: {
        exec: () => Promise.resolve({ stdout: 'work\t2\n', stderr: '', exitCode: 0 }),
        openControl: () => Promise.reject(new Error('not in these tests')),
      },
      fingerprint: 'SHA256:1',
      verdict: { kind: 'known' },
      isConnected: () => true,
      disconnect: () => Promise.resolve(),
    });
  },
});

jest.mock('expo-router', () => ({ useIsFocused: () => true }));
jest.mock('@/diagnostics/device-log', () => ({ deviceLog: () => ({ record: () => {} }) }));
jest.mock('@/storage/device-store', () => ({ deviceHostStore: () => ({ load: async () => ({ hosts: [host] }) }) }));
jest.mock('@/tmux/ssh-connection', () => ({ appConnections: () => mockConnections }));

let reading: ReturnType<typeof useHostReading>;
function Screen({ report }: { report: (value: ReturnType<typeof useHostReading>) => void }) {
  const value = useHostReading(host.id);
  useEffect(() => report(value));
  return null;
}

const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

let renderer: ReactTestRenderer;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(() => act(async () => renderer?.unmount()));

it('says nothing of its own for a Host it cannot reach, and reads again once any use reaches the Host', async () => {
  await act(async () => { renderer = create(<Screen report={(value) => { reading = value; }} />); });
  await act(async () => { await reading.read(); });

  expect(reading.listing).toEqual({ phase: 'host-problem' });
  expect(reading.problem).toEqual({ kind: 'host-unreachable', detail: 'Connection refused (os error 61)' });

  mockDown = false;
  await act(async () => { await mockConnections.read(host, (transport) => transport.exec('true')); });
  await settle();

  expect(reading.problem).toBeNull();
  expect(reading.listing.phase).toBe('read');
});
