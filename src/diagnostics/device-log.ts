import Constants from 'expo-constants';
import * as Device from 'expo-device';

import { createLog, type LogBook } from './log';
import { deviceArchive } from './device-archive';

let book: LogBook | undefined;
let archive: ReturnType<typeof deviceArchive> | undefined;
let launchId: string | undefined;

export function deviceLogs() {
  if (!archive) {
    const startedAt = Date.now();
    launchId = `${startedAt}-${Math.random().toString(36).slice(2, 10)}`;
    archive = deviceArchive({ id: launchId, startedAt, app: describeApp(), device: describeDevice() });
  }
  return archive;
}

export function currentLaunchId(): string {
  deviceLogs();
  return launchId!;
}

export function deviceLog(): LogBook {
  book ??= createLog({ onRecord: (entry) => deviceLogs().record(entry) });
  return book;
}

/** The app and its version, for the head of a report. */
export function describeApp(): string {
  return `Muxify ${Constants.expoConfig?.version ?? 'unversioned'} build ${Constants.platform?.ios?.buildNumber ?? 'unknown'}`;
}

/** The phone and its system, for the head of a report. */
export function describeDevice(): string {
  const model = Device.modelName ?? 'unknown device';
  const system = [Device.osName ?? 'iOS', Device.osVersion ?? ''].join(' ').trim();
  return `${model} · ${system}`;
}
