import { TextEncoder } from 'node:util';
import { createLogArchive, LOG_SEGMENT_BYTES, SAVED_LAUNCHES, type LogFiles } from './archive';

global.TextEncoder = TextEncoder;

function storage() {
  const data = new Map<string, string>();
  const files: LogFiles = {
    names: () => [...data.keys()],
    read: (name) => data.get(name) ?? '',
    write: (name, text) => { data.set(name, text); },
    append: (name, text) => { data.set(name, (data.get(name) ?? '') + text); },
    remove: (name) => { data.delete(name); },
  };
  return { files, data };
}
const launch = (at: number) => ({ id: `${at}-abc`, startedAt: at, app: 'Muxify test build 1', device: 'Test phone' });

it('keeps a previous launch and its error after a new launch starts', () => {
  const { files } = storage();
  const first = createLogArchive(files, launch(100));
  first.record({ at: 101, tag: 'attach', text: 'connected ✓' });
  const error = new Error('render failed');
  Object.assign(error, { componentStack: 'at Header' });
  first.recordError(error, true);
  const second = createLogArchive(files, launch(200));
  const prior = second.launches().find((entry) => entry.id === '100-abc')!;
  expect(prior.text).toContain('connected ✓');
  expect(prior.text).toContain('JavaScript fatal error');
  expect(prior.text).toContain('render failed');
  expect(prior.text).toContain('at Header');
});

it('ignores an incomplete final record and corrupt records', () => {
  const { files, data } = storage();
  const archive = createLogArchive(files, launch(100));
  archive.record({ at: 101, tag: 'app', text: 'kept' });
  files.append('100-abc.0.jsonl', 'invalid\n{"kind":"entry"');
  files.write('unrelated', 'do not remove');
  expect(archive.launches()[0].text).toContain('kept');
  expect(archive.launches()[0].text).not.toContain('invalid');
  expect(data.get('unrelated')).toBe('do not remove');
});

it('retains five launches and bounds each launch by two segments', () => {
  const { files, data } = storage();
  for (let at = 100; at < 108; at += 1) createLogArchive(files, launch(at));
  const archive = createLogArchive(files, launch(108));
  for (let at = 0; at < 2000; at += 1) archive.record({ at, tag: 'app', text: '界'.repeat(400) });
  expect(archive.launches()).toHaveLength(SAVED_LAUNCHES);
  const current = [...data].filter(([name]) => name.startsWith('108-abc.'));
  expect(current).toHaveLength(2);
  expect(current.every(([, text]) => new TextEncoder().encode(text).length <= LOG_SEGMENT_BYTES)).toBe(true);
  expect(archive.launches()[0].text).toContain('界');
});

it('reports disk failure without throwing from recording or reading', () => {
  const { files } = storage();
  const archive = createLogArchive(files, launch(100));
  files.append = () => { throw new Error('disk full'); };
  expect(() => archive.record({ at: 101, tag: 'app', text: 'event' })).not.toThrow();
  expect(archive.unavailable()).toBe(true);
  expect(() => archive.recordError(new Error('fatal'), true)).not.toThrow();
  expect(archive.launches()).toHaveLength(1);
});

it('skips an invalid launch date and keeps later valid logs writable', () => {
  const { files } = storage();
  files.write('10-abc.0.jsonl', JSON.stringify({ kind: 'launch', ...launch(10), startedAt: 1e100 }) + '\n');
  const archive = createLogArchive(files, launch(100));
  expect(archive.launches().map((entry) => entry.id)).toEqual(['100-abc']);
  archive.record({ at: 101, tag: 'app', text: 'after corrupt launch' });
  expect(archive.launches()[0].text).toContain('after corrupt launch');
});

it('keeps recording when one saved launch cannot be read', () => {
  const { files } = storage();
  createLogArchive(files, launch(100));
  const archive = createLogArchive(files, launch(200));
  const read = files.read;
  files.read = (name) => {
    if (name.startsWith('100-')) throw new Error('unreadable old file');
    return read(name);
  };
  expect(archive.launches().map((entry) => entry.id)).toEqual(['200-abc']);
  expect(archive.unavailable()).toBe(true);
  archive.record({ at: 201, tag: 'app', text: 'after failed read' });
  expect(archive.launches()[0].text).toContain('after failed read');
});
