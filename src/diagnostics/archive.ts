import { formatEntry, type LogEntry } from './log';

export interface LogFiles {
  names(): string[];
  read(name: string): string;
  write(name: string, text: string): void;
  append(name: string, text: string): void;
  remove(name: string): void;
}

export interface Launch {
  id: string;
  startedAt: number;
  app: string;
  device: string;
}

export interface SavedLog extends Launch {
  text: string;
}

const FILE_NAME = /^(\d+-[a-z0-9]+)\.(\d+)\.jsonl$/;
export const LOG_SEGMENT_BYTES = 256 * 1024;
export const SAVED_LAUNCHES = 5;
const ERROR_LIMIT = 16 * 1024;

export function createLogArchive(files: LogFiles, launch: Launch) {
  let segment = 0;
  let bytes = 0;
  let unavailable = false;
  let writeFailed = false;
  const encoder = new TextEncoder();
  const name = () => `${launch.id}.${segment}.jsonl`;
  const head = JSON.stringify({ kind: 'launch', ...launch }) + '\n';

  function safely(action: () => void, writing = false) {
    try { action(); } catch {
      unavailable = true;
      if (writing) writeFailed = true;
    }
  }

  function beginSegment() {
    files.write(name(), head);
    bytes = encoder.encode(head).length;
  }

  safely(() => {
    beginSegment();
    const ids = [...new Set(files.names().map((file) => FILE_NAME.exec(file)?.[1]).filter((id): id is string => !!id))].sort().reverse();
    const old = new Set(ids.slice(SAVED_LAUNCHES));
    for (const file of files.names()) {
      const match = FILE_NAME.exec(file);
      if (match && old.has(match[1])) files.remove(file);
    }
  }, true);

  function append(record: object) {
    if (writeFailed) return;
    safely(() => {
      const text = JSON.stringify(record) + '\n';
      const size = encoder.encode(text).length;
      if (bytes + size > LOG_SEGMENT_BYTES) {
        segment += 1;
        beginSegment();
        if (segment > 1) files.remove(`${launch.id}.${segment - 2}.jsonl`);
      }
      files.append(name(), text);
      bytes += size;
    }, true);
  }

  return {
    record(entry: LogEntry) { append({ kind: 'entry', ...entry }); },
    recordError(error: unknown, fatal: boolean) {
      let message = 'Unknown JavaScript error';
      let stack = '';
      try {
        if (error instanceof Error) {
          message = `${error.name}: ${error.message}`;
          stack = error.stack ?? '';
          if ('componentStack' in error && typeof error.componentStack === 'string') stack += `\nComponents:\n${error.componentStack}`;
        } else if (typeof error === 'string') message = error;
      } catch { /* An error with throwing accessors must not replace the original error. */ }
      append({ kind: 'error', at: Date.now(), fatal, message: message.slice(0, ERROR_LIMIT), stack: stack.slice(0, ERROR_LIMIT) });
    },
    unavailable: () => unavailable,
    launches(): SavedLog[] {
      const result = new Map<string, SavedLog>();
      safely(() => {
        const names = files.names().filter((file) => FILE_NAME.test(file)).sort((a, b) => {
          const left = FILE_NAME.exec(a)!;
          const right = FILE_NAME.exec(b)!;
          return left[1].localeCompare(right[1]) || Number(left[2]) - Number(right[2]);
        });
        for (const file of names) {
          let contents: string;
          try { contents = files.read(file); } catch { unavailable = true; continue; }
          const lines = contents.split('\n');
          lines.pop();
          let saved: SavedLog | undefined;
          for (const line of lines) {
            let value: Record<string, unknown>;
            try { value = JSON.parse(line); } catch { continue; }
            if (!value || typeof value !== 'object') continue;
            if (value.kind === 'launch' && value.id === FILE_NAME.exec(file)![1] &&
                typeof value.startedAt === 'number' && Number.isFinite(new Date(value.startedAt).getTime()) &&
                typeof value.app === 'string' && typeof value.device === 'string') {
              const id = String(value.id);
              saved = result.get(id) ?? { id, startedAt: value.startedAt, app: value.app, device: value.device,
                text: `Launch: ${new Date(value.startedAt).toISOString()}\nApp: ${value.app}\nDevice: ${value.device}\n\n` };
              result.set(id, saved);
            } else if (saved && value.kind === 'entry' && typeof value.at === 'number' &&
                       typeof value.tag === 'string' && typeof value.text === 'string') {
              saved.text += formatEntry({ at: value.at, tag: value.tag, text: value.text }) + '\n';
            } else if (saved && value.kind === 'error' && typeof value.message === 'string' && typeof value.stack === 'string') {
              saved.text += `\nJavaScript ${value.fatal ? 'fatal error' : 'error'}\n${value.message}\n${value.stack}\n`;
            }
          }
        }
      });
      return [...result.values()].sort((a, b) => b.startedAt - a.startedAt);
    },
  };
}
