import Constants from 'expo-constants';
import * as Device from 'expo-device';

import { createLog, type LogBook } from './log';

let book: LogBook | undefined;

/**
 * The app's one Log.
 *
 * Held for the life of the process and nowhere else: it is not written to
 * disk, so a Log describes this launch and a crash takes it with it. That is
 * the trade for a record nothing has to be asked before writing to. What it
 * is for — a Pane that came up wrong a minute ago — survives it.
 */
export function deviceLog(): LogBook {
  book ??= createLog();
  return book;
}

/** The app and its version, for the head of a report. */
export function describeApp(): string {
  return `Muxify ${Constants.expoConfig?.version ?? 'unversioned'}`;
}

/** The phone and its system, for the head of a report. */
export function describeDevice(): string {
  const model = Device.modelName ?? 'unknown device';
  const system = [Device.osName ?? 'iOS', Device.osVersion ?? ''].join(' ').trim();
  return `${model} · ${system}`;
}
