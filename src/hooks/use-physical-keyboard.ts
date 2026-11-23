import { requireOptionalNativeModule } from 'expo';
import { useSyncExternalStore } from 'react';
import { Keyboard, Platform } from 'react-native';

import {
  initialPresence,
  isPhysicalKeyboardAttached,
  nextPresence,
  type PresenceEvidence,
} from '@/lib/physical-keyboard-presence';

interface PhysicalKeyboardModule {
  isConnected(): boolean;
  addListener(
    event: 'onChange',
    listener: (event: { connected: boolean; cause: 'connect' | 'disconnect' | 'check' }) => void,
  ): { remove(): void };
}

const physicalKeyboard = Platform.OS === 'ios'
  ? requireOptionalNativeModule<PhysicalKeyboardModule>('PhysicalKeyboard')
  : null;

if (Platform.OS === 'ios' && !physicalKeyboard) {
  throw new Error('PhysicalKeyboard is unavailable. Rebuild the iOS app to include the native module.');
}

/**
 * One presence for the whole app, fed from the first subscriber on. The
 * evidence outlives any one screen: a software keyboard seen on the Host
 * Screen, or before a reconnect remounted the Terminal, still counts.
 */
let presence = initialPresence(physicalKeyboard?.isConnected() ?? false);
let attached = isPhysicalKeyboardAttached(presence);
const subscribers = new Set<() => void>();
let started = false;

function observe(evidence: PresenceEvidence) {
  presence = nextPresence(presence, evidence);
  const now = isPhysicalKeyboardAttached(presence);
  if (now === attached) return;
  attached = now;
  subscribers.forEach((notify) => notify());
}

function start() {
  if (started || !physicalKeyboard) return;
  started = true;
  physicalKeyboard.addListener('onChange', ({ connected, cause }) => {
    observe({ kind: cause === 'check' ? 'checked' : 'announced', connected });
  });
  for (const name of ['keyboardDidShow', 'keyboardDidChangeFrame'] as const) {
    Keyboard.addListener(name, (event) => observe({ kind: 'softwareKeyboard', height: event.endCoordinates.height }));
  }
  Keyboard.addListener('keyboardDidHide', () => observe({ kind: 'softwareKeyboard', height: 0 }));
  observe({ kind: 'checked', connected: physicalKeyboard.isConnected() });
  const metrics = Keyboard.metrics();
  if (metrics) observe({ kind: 'softwareKeyboard', height: metrics.height });
}

function subscribe(notify: () => void) {
  subscribers.add(notify);
  start();
  return () => { subscribers.delete(notify); };
}

const snapshot = () => attached;

/** Whether a physical keyboard is attached, so the Key Row steps aside. */
export function usePhysicalKeyboard(): boolean {
  return useSyncExternalStore(subscribe, snapshot);
}
