import { readFileSync } from 'fs';
import { join } from 'path';

/** One frame of a MuxifyCore protocol fixture, parsed. */
export type ProtocolFrame = { id: number; kind: string } & Record<string, any>;

/**
 * The frames of a fixture that MuxifyCore's tests pin, copied into
 * `src/ssh/__fixtures__/host-server`, in their order.
 */
export function protocolFrames(name: '5-board' | '6-go-to'): ProtocolFrame[] {
  const text = readFileSync(join(__dirname, '..', 'ssh', '__fixtures__', 'host-server', name, 'frames.jsonl'), 'utf8');
  return text.split('\n').filter((line) => line.length > 0).map((line) => JSON.parse(line) as ProtocolFrame);
}
