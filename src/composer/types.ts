/** A local, owned copy. Disposal never deletes the user's original file. */
export interface AttachmentFile {
  uri: string;
  name: string;
  size: number;
  image: boolean;
  open(): { readBytes(length: number): Uint8Array; close(): void };
  dispose(): void;
}

export interface UploadProgress { sent: number; total: number }

export type Upload = (
  file: AttachmentFile,
  signal: AbortSignal,
  progress: (value: UploadProgress) => void,
) => Promise<string>;

export interface ComposerDestination {
  upload: Upload;
  /** Called immediately before the first command that can reach the Pane. */
  deliver(text: string, signal: AbortSignal, started: () => void): Promise<void>;
}

export function uniqueId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function checkAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new Error('Send cancelled. Draft kept.');
}

/** Stop waiting promptly; the operation itself must also check before acting. */
export function abortable<T>(work: Promise<T>, signal: AbortSignal, timeout?: number): Promise<T> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => { signal.removeEventListener('abort', abort); clearTimeout(timer); };
    const abort = () => { cleanup(); reject(new Error('Send cancelled. Draft kept.')); };
    signal.addEventListener('abort', abort);
    if (timeout) timer = setTimeout(() => { cleanup(); reject(new Error('Upload timed out. Draft kept.')); }, timeout);
    // Install handlers even when already aborted: a late rejection is owned.
    work.then((value) => { cleanup(); resolve(value); }, (error) => { cleanup(); reject(error); });
    if (signal.aborted) abort();
  });
}
