import type { AttachState } from '@/tmux/attach';
import { describeTopology } from '@/tmux/topology';

import { formatEntry, type LogBook } from './log';

/** What the Log is read against: which app, which phone, and what is up. */
export interface ReportContext {
  /** The app and its version, as `Muxify 1.0.0`. */
  app: string;
  /** The phone and its system, as `iPhone 17 Pro · iOS 26.5`. */
  device: string;
  now: number;
  /** The attached Session as it stands this moment, or null when nothing is. */
  attached: { hostName: string; state: AttachState } | null;
}

/**
 * The Log as the user carries it away: a few lines of where things stand,
 * then everything that was recorded.
 *
 * The head is the part the Log itself cannot say. Each entry is one moment;
 * what the Attach *is* when the copy is made — its phase, its Topology, the
 * grid its Client is sized to — is the state all those moments added up to,
 * and it is the first thing a reader wants beside the last line. So it is
 * written at the top, from the Attach's own state rather than from the Log.
 */
export function renderReport(book: LogBook, context: ReportContext): string {
  const entries = book.entries();
  const head = [
    `Muxify log — ${stamp(context.now)}`,
    `App: ${context.app}`,
    `Device: ${context.device}`,
    ...describeAttached(context.attached),
    `Entries: ${entries.length}, oldest first`,
    '',
  ];
  return [...head, ...entries.map(formatEntry)].join('\n');
}

function describeAttached(attached: ReportContext['attached']): string[] {
  if (!attached) return ['Attached: nothing'];
  const { hostName, state } = attached;
  const phase =
    state.phase.kind === 'disconnected'
      ? `disconnected (${state.phase.reason.kind}: ${state.phase.reason.detail})`
      : state.phase.kind;
  const lines = [
    `Attached: ${hostName} / ${state.sessionName} — ${phase}`,
    `  Topology: ${describeTopology(state.topology)}`,
    `  Client grid: ${state.grid ? `${state.grid.cols}x${state.grid.rows}` : 'none yet'}` +
      `; Zoom preference ${state.zoomed ? 'on' : 'off'}` +
      `; row in sight ${state.rowInSight ?? 'unread'}` +
      `; mouse tracking ${state.mouseTracking ? 'on' : 'off'}` +
      `; scrolled ${state.scrolled ? `${state.scrolled.back} back` : 'live'}`,
  ];
  if (state.trouble) lines.push(`  Trouble: ${state.trouble}`);
  return lines;
}

/** `2026-09-21 16:50:12`, in the phone's own time. */
function stamp(at: number): string {
  const date = new Date(at);
  const two = (value: number) => String(value).padStart(2, '0');
  return (
    `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ` +
    `${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds())}`
  );
}
