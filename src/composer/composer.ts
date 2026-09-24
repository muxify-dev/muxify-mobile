import { shellQuote } from '@/tmux/commands';

import { abortable, checkAborted, uniqueId, type AttachmentFile, type ComposerDestination, type UploadProgress } from './types';

export interface Attachment {
  id: string;
  name: string;
  phase: 'preparing' | 'ready' | 'failed';
  file?: AttachmentFile;
}

export interface Draft {
  text: string;
  attachments: Attachment[];
  phase: 'idle' | 'uploading' | 'sending' | 'uncertain';
  progress?: UploadProgress;
  message?: string;
}

export interface Composer {
  draft(paneId: string): Draft;
  subscribe(listener: () => void): () => void;
  edit(paneId: string, text: string): void;
  add(paneId: string, name: string, prepare: () => Promise<AttachmentFile>, release?: () => void): void;
  remove(paneId: string, id: string): void;
  retry(paneId: string, id: string): void;
  send(paneId: string): Promise<void>;
  cancel(paneId: string): void;
  acknowledge(paneId: string): void;
  interrupt(): void;
  dispose(): void;
}

const EMPTY: Draft = { text: '', attachments: [], phase: 'idle' };
export const busy = (draft: Draft) => draft.phase === 'uploading' || draft.phase === 'sending';

/** One draft per Pane, surviving screens and Connection replacements. */
export function createComposer(destination: (paneId: string) => ComposerDestination): Composer {
  const drafts = new Map<string, Draft>();
  const preparations = new Map<string, () => Promise<AttachmentFile>>();
  const releases = new Map<string, () => void>();
  const attempts = new Map<string, object>();
  const sends = new Map<string, AbortController>();
  const listeners = new Set<() => void>();
  let disposed = false;

  const draft = (paneId: string) => drafts.get(paneId) ?? EMPTY;
  function change(paneId: string, over: Partial<Draft>) {
    if (disposed) return;
    drafts.set(paneId, { ...draft(paneId), ...over });
    for (const listener of [...listeners]) listener();
  }
  function cleanup(file?: AttachmentFile) { try { file?.dispose(); } catch { /* Best effort cache cleanup. */ } }
  function release(id: string) {
    releases.get(id)?.();
    releases.delete(id);
    preparations.delete(id);
  }
  async function prepare(paneId: string, id: string) {
    const source = preparations.get(id);
    if (!source || disposed) return;
    const attempt = {};
    attempts.set(id, attempt);
    const update = (over: Partial<Attachment>) => change(paneId, {
      attachments: draft(paneId).attachments.map((item) => item.id === id ? { ...item, ...over } : item),
    });
    update({ phase: 'preparing' });
    try {
      const file = await source();
      if (disposed || attempts.get(id) !== attempt) { cleanup(file); return; }
      update({ name: file.name, file, phase: 'ready' });
    } catch {
      if (!disposed && attempts.get(id) === attempt) update({ phase: 'failed' });
    }
  }

  const composer: Composer = {
    draft,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    edit(paneId, text) {
      if (!busy(draft(paneId))) change(paneId, { text });
    },
    add(paneId, name, source, releaseSource) {
      if (disposed || busy(draft(paneId))) { releaseSource?.(); return; }
      const id = uniqueId();
      preparations.set(id, source);
      if (releaseSource) releases.set(id, releaseSource);
      change(paneId, { attachments: [...draft(paneId).attachments, { id, name, phase: 'preparing' }], message: undefined });
      void prepare(paneId, id);
    },
    remove(paneId, id) {
      if (busy(draft(paneId))) return;
      cleanup(draft(paneId).attachments.find((item) => item.id === id)?.file);
      attempts.delete(id);
      release(id);
      change(paneId, { attachments: draft(paneId).attachments.filter((item) => item.id !== id) });
    },
    retry(paneId, id) {
      if (!busy(draft(paneId)) && draft(paneId).attachments.some((item) => item.id === id && item.phase === 'failed')) {
        void prepare(paneId, id);
      }
    },
    async send(paneId) {
      const snapshot = draft(paneId);
      if (disposed || snapshot.phase !== 'idle' || (!snapshot.text.trim() && !snapshot.attachments.length)) return;
      if (snapshot.attachments.some((item) => item.phase !== 'ready')) return;
      const controller = new AbortController();
      sends.set(paneId, controller);
      let delivered = false;
      change(paneId, { phase: 'uploading', message: undefined, progress: undefined });
      try {
        const target = destination(paneId);
        const paths: string[] = [];
        const total = snapshot.attachments.reduce((sum, item) => sum + item.file!.size, 0);
        let completed = 0;
        for (const item of snapshot.attachments) {
          const file = item.file!;
          checkAborted(controller.signal);
          paths.push(await abortable(target.upload(file, controller.signal, ({ sent }) => {
            if (!controller.signal.aborted) change(paneId, { progress: { sent: completed + sent, total } });
          }), controller.signal));
          completed += file.size;
        }
        checkAborted(controller.signal);
        const message = [snapshot.text, paths.map(shellQuote).join(' ')].filter(Boolean).join('\n');
        change(paneId, { phase: 'sending', progress: undefined });
        await abortable(target.deliver(message, controller.signal, () => { delivered = true; }), controller.signal);
        for (const item of snapshot.attachments) {
          cleanup(item.file);
          release(item.id);
          attempts.delete(item.id);
        }
        change(paneId, { ...EMPTY, message: undefined, progress: undefined });
      } catch (error) {
        change(paneId, {
          phase: delivered ? 'uncertain' : 'idle',
          progress: undefined,
          message: delivered
            ? 'Delivery may have reached the Pane. Check the terminal before sending again.'
            : error instanceof Error ? error.message : 'Couldn’t send. Draft kept.',
        });
      } finally {
        if (sends.get(paneId) === controller) sends.delete(paneId);
      }
    },
    cancel(paneId) { sends.get(paneId)?.abort(); },
    acknowledge(paneId) {
      if (draft(paneId).phase === 'uncertain') change(paneId, { phase: 'idle', message: undefined });
    },
    interrupt() { for (const controller of sends.values()) controller.abort(); },
    dispose() {
      disposed = true;
      composer.interrupt();
      for (const held of drafts.values()) for (const item of held.attachments) cleanup(item.file);
      drafts.clear();
      attempts.clear();
      for (const id of releases.keys()) release(id);
      preparations.clear();
      listeners.clear();
    },
  };
  return composer;
}
