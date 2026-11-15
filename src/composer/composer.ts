import { whyDiscarded } from '@/lib/input-notice-copy';
import { shellQuote } from '@/tmux/commands';
import type { MessageFate, MessageId } from '@/tmux/input-lane';

import { abortable, checkAborted, uniqueId, type AttachmentFile, type ComposerDestination, type UploadProgress } from './types';

export interface Attachment {
  id: string;
  name: string;
  phase: 'preparing' | 'ready' | 'failed';
  file?: AttachmentFile;
}

export type DraftPhase =
  | { readonly kind: 'idle' }
  | { readonly kind: 'uploading'; readonly progress?: UploadProgress }
  /**
   * The message is in the Pane's Lane, and the Lane has not settled it. The
   * Draft keeps the text until tmux confirms it, so a message that the Lane
   * throws away is still here.
   */
  | { readonly kind: 'sending'; readonly id: MessageId };

export interface Draft {
  text: string;
  attachments: Attachment[];
  phase: DraftPhase;
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
  /** What became of the message that a Send handed to the Pane's Lane. */
  settle(paneId: string, id: MessageId, fate: MessageFate): void;
  /** Empties a Draft that takes edits: the user discarded its message. */
  clear(paneId: string): void;
  /**
   * Moves a Draft's text and attachments into another Pane's Draft, after
   * the text that Draft has, and drops the first Draft. False when either
   * Draft takes no edit, or there is nothing to move.
   */
  move(from: string, to: string): boolean;
  cancel(paneId: string): void;
  interrupt(): void;
  dispose(): void;
}

const IDLE = { kind: 'idle' } as const;
const EMPTY: Draft = { text: '', attachments: [], phase: IDLE };
/** The Draft takes no edit: its attachments upload, or its message is in the Lane. */
export const busy = (draft: Draft) => draft.phase.kind !== 'idle';

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
  function empty(paneId: string) {
    for (const item of draft(paneId).attachments) {
      cleanup(item.file);
      release(item.id);
      attempts.delete(item.id);
    }
    change(paneId, EMPTY);
  }
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
      if (disposed || busy(snapshot) || (!snapshot.text.trim() && !snapshot.attachments.length)) return;
      if (snapshot.attachments.some((item) => item.phase !== 'ready')) return;
      const controller = new AbortController();
      sends.set(paneId, controller);
      change(paneId, { phase: { kind: 'uploading' }, message: undefined });
      try {
        const target = destination(paneId);
        const paths: string[] = [];
        const total = snapshot.attachments.reduce((sum, item) => sum + item.file!.size, 0);
        let completed = 0;
        for (const item of snapshot.attachments) {
          const file = item.file!;
          checkAborted(controller.signal);
          paths.push(await abortable(target.upload(file, controller.signal, ({ sent }) => {
            if (!controller.signal.aborted) change(paneId, { phase: { kind: 'uploading', progress: { sent: completed + sent, total } } });
          }), controller.signal));
          completed += file.size;
        }
        checkAborted(controller.signal);
        const message = [snapshot.text, paths.map(shellQuote).join(' ')].filter(Boolean).join('\n');
        const id = uniqueId() as MessageId;
        // Before `deliver`: a held Lane can settle the message inside that call.
        change(paneId, { phase: { kind: 'sending', id } });
        target.deliver(message, id);
      } catch (error) {
        change(paneId, {
          phase: IDLE,
          message: error instanceof Error ? error.message : 'Couldn’t send. Draft kept.',
        });
      } finally {
        if (sends.get(paneId) === controller) sends.delete(paneId);
      }
    },
    settle(paneId, id, fate) {
      const { phase } = draft(paneId);
      if (phase.kind !== 'sending' || phase.id !== id) return;
      if (fate.kind === 'delivered') empty(paneId);
      else if (fate.kind === 'taken') change(paneId, { phase: IDLE });
      else change(paneId, { phase: IDLE, message: `Not sent: ${whyDiscarded(fate.reason)}. The Draft is kept.` });
    },
    clear(paneId) {
      if (!busy(draft(paneId))) empty(paneId);
    },
    move(from, to) {
      const source = draft(from);
      const target = draft(to);
      if (disposed || from === to || busy(source) || busy(target)) return false;
      if (!source.text && !source.attachments.length) return false;
      // A preparation that ends later writes to the Draft it started in.
      if (source.attachments.some((item) => item.phase === 'preparing')) return false;
      drafts.delete(from);
      change(to, {
        text: [target.text, source.text].filter(Boolean).join('\n'),
        attachments: [...target.attachments, ...source.attachments],
        message: undefined,
      });
      return true;
    },
    cancel(paneId) { sends.get(paneId)?.abort(); },
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
