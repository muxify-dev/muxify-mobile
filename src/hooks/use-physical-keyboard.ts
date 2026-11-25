import { requireOptionalNativeModule } from 'expo';
import { useSyncExternalStore } from 'react';
import { Dimensions, Keyboard, Platform } from 'react-native';

import { deviceLog } from '@/diagnostics/device-log';
import { speakingAs } from '@/diagnostics/log';
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
const say = speakingAs(deviceLog(), 'keyboard');

/** A software keyboard frame as the Log shows it: where it starts on the screen, not only how tall it is. */
function frameWords(frame: { screenY: number; height: number }): string {
  return `y ${Math.round(frame.screenY)}, height ${Math.round(frame.height)}, screen ${Math.round(Dimensions.get('screen').height)}`;
}

/**
 * Each input and the presence it leaves, in the Log, so a Key Row that comes
 * back over a connected keyboard can be traced to the input that brought it.
 */
function observe(evidence: PresenceEvidence, input: string) {
  presence = nextPresence(presence, evidence);
  const now = isPhysicalKeyboardAttached(presence);
  say(`presence: ${input} → reported ${presence.reported}, overruled ${presence.overruled}, ${now ? 'attached' : 'not attached'}`);
  if (now === attached) return;
  attached = now;
  subscribers.forEach((notify) => notify());
}

function start() {
  if (started || !physicalKeyboard) return;
  started = true;
  physicalKeyboard.addListener('onChange', ({ connected, cause }) => {
    observe({ kind: cause === 'check' ? 'checked' : 'announced', connected },
      `GameController ${cause}, ${connected ? 'connected' : 'not connected'}`);
  });
  for (const name of ['keyboardDidShow', 'keyboardDidChangeFrame'] as const) {
    Keyboard.addListener(name, (event) => observe({ kind: 'softwareKeyboard', height: event.endCoordinates.height },
      `${name}, ${frameWords(event.endCoordinates)}`));
  }
  Keyboard.addListener('keyboardDidHide', () => observe({ kind: 'softwareKeyboard', height: 0 }, 'keyboardDidHide'));
  const connected = physicalKeyboard.isConnected();
  observe({ kind: 'checked', connected }, `GameController first check, ${connected ? 'connected' : 'not connected'}`);
  const metrics = Keyboard.metrics();
  if (metrics) observe({ kind: 'softwareKeyboard', height: metrics.height }, `keyboard metrics at start, ${frameWords(metrics)}`);
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
