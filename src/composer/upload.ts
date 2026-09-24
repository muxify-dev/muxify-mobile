import { base64ToBytes } from '@/lib/base64';
import { bytesToUtf8 } from '@/lib/utf8';
import { shellQuote } from '@/tmux/commands';

import { abortable, checkAborted, uniqueId, type Upload } from './types';

export interface UploadChannel {
  write(data: string | Uint8Array): void;
  sendEof(): void;
  close(): Promise<void>;
}

export type OpenUploadChannel = (
  command: string,
  events: { onData(data: ArrayBuffer): void; onClosed(code?: number): void },
) => Promise<UploadChannel>;

/** One acknowledged chunk at a time: the native write API has no backpressure. */
const CHUNK = 64 * 1024;
const TIMEOUT = 30_000;

/** head -c, wc and base64 are available on both macOS and Linux Hosts. */
export function uploadCommand(id: string, name: string, size: number): string {
  const filename = name.replace(/[\x00-\x1f\x7f/\\]/g, '_').slice(0, 120) || 'attachment';
  const script = `set -eu
umask 077
dir="$HOME/.cache/muxify/attachments/${id}"
mkdir -p "$dir"
tmp="$dir/.upload.part"
final="$dir/"${shellQuote(filename)}
trap 'rm -f "$tmp"' EXIT
trap 'exit 1' HUP INT TERM
: > "$tmp"
printf 'READY\\n'
received=0
while [ "$received" -lt ${size} ]; do
  count=$((${size} - received))
  [ "$count" -le ${CHUNK} ] || count=${CHUNK}
  head -c "$count" >> "$tmp"
  received=$((received + count))
  [ "$(wc -c < "$tmp" | tr -d ' ')" = "$received" ]
  printf 'ACK\\n'
done
IFS= read -r commit
[ "$commit" = COMMIT ]
mv "$tmp" "$final"
printf 'PATH '
printf '%s' "$final" | base64 | tr -d '\\n'
printf '\\n'
`;
  return `/bin/sh -c ${shellQuote(script)}`;
}

/** Upload bytes on their own SSH channel; never write a command into a Pane. */
export function createUploader(open: OpenUploadChannel): Upload {
  return async (file, signal, progress) => {
    checkAborted(signal);
    const reader = file.open();
    let channel: UploadChannel | undefined;
    let pending: { resolve(line: string): void; reject(error: Error): void } | undefined;
    let fault: Error | undefined;
    const lines: string[] = [];
    let buffered = '';
    let exited = false;
    let finished = false;

    function fail(error: Error) {
      fault = error;
      pending?.reject(error);
      pending = undefined;
    }
    function receive(line: string) {
      if (pending) {
        const waiter = pending;
        pending = undefined;
        waiter.resolve(line);
      } else if (lines.length < 4) lines.push(line);
      else fail(new Error('Unexpected upload response.'));
    }
    function next(): Promise<string> {
      checkAborted(signal);
      if (fault) return Promise.reject(fault);
      const line = lines.shift();
      if (line !== undefined) return Promise.resolve(line);
      return new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => fail(new Error('Upload timed out. Draft kept.')), TIMEOUT);
        pending = {
          resolve: (value) => { clearTimeout(timer); resolve(value); },
          reject: (error) => { clearTimeout(timer); reject(error); },
        };
      });
    }
    const abort = () => {
      fail(new Error('Send cancelled. Draft kept.'));
      void channel?.close().catch(() => {});
    };
    signal.addEventListener('abort', abort);
    try {
      channel = await abortable<UploadChannel>(open(uploadCommand(uniqueId(), file.name, file.size), {
        onData(data) {
          // Protocol is ASCII; the only non-ASCII field (path) is base64.
          buffered += bytesToUtf8(new Uint8Array(data));
          if (buffered.length > 32_768) { fail(new Error('Invalid upload response.')); return; }
          let end: number;
          while ((end = buffered.indexOf('\n')) >= 0) {
            receive(buffered.slice(0, end));
            buffered = buffered.slice(end + 1);
          }
        },
        onClosed(code) {
          exited = true;
          if (code !== 0) fail(new Error('Upload failed on the Host. Draft kept.'));
          else receive('EXIT');
        },
      }).then((opened) => {
        if (finished || signal.aborted) void opened.close().catch(() => {});
        return opened;
      }), signal, TIMEOUT);
      checkAborted(signal);
      if (await next() !== 'READY') throw new Error('Could not start the upload.');
      let sent = 0;
      progress({ sent, total: file.size });
      while (sent < file.size) {
        checkAborted(signal);
        const count = Math.min(CHUNK, file.size - sent);
        const bytes = reader.readBytes(count);
        if (bytes.length !== count) throw new Error('The local attachment could not be read.');
        channel.write(bytes);
        if (await next() !== 'ACK') throw new Error('The Host did not acknowledge the upload.');
        sent += bytes.length;
        progress({ sent, total: file.size });
      }
      checkAborted(signal);
      channel.write('COMMIT\n');
      channel.sendEof();
      const reply = await next();
      if (!reply.startsWith('PATH ')) throw new Error('The Host did not finish the upload.');
      if (await next() !== 'EXIT') throw new Error('The upload did not complete.');
      checkAborted(signal);
      const absolute = bytesToUtf8(base64ToBytes(reply.slice(5)));
      if (!absolute.startsWith('/') || /[\x00-\x1f\x7f]/.test(absolute)) {
        throw new Error('The Host returned an invalid attachment path.');
      }
      return absolute;
    } finally {
      finished = true;
      signal.removeEventListener('abort', abort);
      reader.close();
      if (!exited) void channel?.close().catch(() => {});
    }
  };
}
