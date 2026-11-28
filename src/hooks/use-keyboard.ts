import { requireOptionalNativeModule } from 'expo';
import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';

import { deviceLog } from '@/diagnostics/device-log';
import { speakingAs } from '@/diagnostics/log';
import { UNKNOWN_KEYBOARD, type KeyboardSnapshot, type PhysicalKeyboard } from '@/domain/keyboard';
import type { ScreenRect } from '@/lib/terminal-clearance';

/** What the KeyboardSnapshot module sends, with the event that changed it, for the Log. */
interface NativeSnapshot {
  physical: PhysicalKeyboard;
  software?: ScreenRect | null;
  event: string;
  gcConnected?: boolean | null;
  staleSuspected: boolean;
}

interface KeyboardSnapshotModule {
  snapshot(): NativeSnapshot;
  addListener(event: 'onChange', listener: (snapshot: NativeSnapshot) => void): { remove(): void };
}

const native = Platform.OS === 'ios'
  ? requireOptionalNativeModule<KeyboardSnapshotModule>('KeyboardSnapshot')
  : null;

if (Platform.OS === 'ios' && !native) {
  throw new Error('KeyboardSnapshot is unavailable. Rebuild the iOS app to include the native module.');
}

/** A platform with no native module has no physical keyboard to wait for. */
const NO_NATIVE: KeyboardSnapshot = { physical: 'absent', software: null };

/**
 * The one mirror of the native snapshot for the whole app, fed from the first
 * subscriber on. It outlives any one screen: what the module learned before a
 * reconnect remounted the Terminal still counts. It holds the unknown snapshot
 * until the module answers, so nothing is decided on a guess.
 */
let current: KeyboardSnapshot = native ? UNKNOWN_KEYBOARD : NO_NATIVE;
const subscribers = new Set<() => void>();
let started = false;
const say = speakingAs(deviceLog(), 'keyboard');

const rectWords = (rect: ScreenRect | null) =>
  rect ? `${Math.round(rect.x)},${Math.round(rect.y)} ${Math.round(rect.width)}x${Math.round(rect.height)}` : 'none';

/**
 * One line for each snapshot, so a Key Row that comes back over a connected
 * keyboard can be traced in a device Log to the event that brought it. A change
 * of the physical keyboard also gets the line that the Log has always had for it.
 */
function receive(from: NativeSnapshot) {
  const next: KeyboardSnapshot = { physical: from.physical, software: from.software ?? null };
  say(`${from.event} → physical ${from.physical}, software ${rectWords(next.software)}, ` +
    `gcConnected ${from.gcConnected ?? 'unknown'}, staleSuspected ${from.staleSuspected}`);
  const before = current;
  current = next;
  if (before.physical !== next.physical && next.physical !== 'unknown') {
    say(`physical keyboard ${next.physical === 'inUse' ? 'connected' : 'disconnected'}`);
  }
  subscribers.forEach((notify) => notify());
}

function start() {
  if (started || !native) return;
  started = true;
  native.addListener('onChange', receive);
  receive(native.snapshot());
}

/**
 * Calls `listener` with each snapshot after the first, the way for the app's
 * own code, which has no React, to follow the keyboard.
 */
export function subscribeKeyboard(listener: (snapshot: KeyboardSnapshot, before: KeyboardSnapshot) => void): () => void {
  let seen = current;
  return subscribe(() => {
    const before = seen;
    seen = current;
    listener(current, before);
  });
}

function subscribe(notify: () => void) {
  subscribers.add(notify);
  start();
  return () => { subscribers.delete(notify); };
}

const read = () => current;

/** What iOS says about the keyboard now. The only source: see keyboardPlan. */
export function useKeyboard(): KeyboardSnapshot {
  return useSyncExternalStore(subscribe, read);
}
