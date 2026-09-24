import { createComposer } from './composer';
import type { AttachmentFile, ComposerDestination } from './types';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function file(name = 'image.png'): AttachmentFile {
  return { uri: `file:///${name}`, name, size: 10, image: true,
    open: () => { throw new Error('unused'); }, dispose: jest.fn() };
}

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

function setup(over: Partial<ComposerDestination> = {}) {
  const deliver = jest.fn(async (_text: string, _signal: AbortSignal, started: () => void) => { started(); });
  const upload = jest.fn(async (attachment: AttachmentFile) => `/home/me/${attachment.name}`);
  const destination = jest.fn(() => ({ deliver, upload, ...over }));
  return { composer: createComposer(destination), deliver, upload, destination };
}

it('keeps independent drafts and clears only the submitted Pane after all uploads', async () => {
  const { composer, deliver, destination } = setup();
  const first = file("a 'quoted'.png");
  const second = file('b.pdf');
  composer.edit('%1', 'Explain these\nincluding details');
  composer.edit('%2', 'another draft');
  composer.add('%1', first.name, async () => first);
  composer.add('%1', second.name, async () => second);
  await tick();
  await composer.send('%1');
  expect(destination).toHaveBeenCalledWith('%1');
  expect(deliver.mock.calls[0][0]).toBe("Explain these\nincluding details\n'/home/me/a '\\''quoted'\\''.png' '/home/me/b.pdf'");
  expect(composer.draft('%1').text).toBe('');
  expect(composer.draft('%1').attachments).toEqual([]);
  expect(composer.draft('%2').text).toBe('another draft');
  expect(first.dispose).toHaveBeenCalledTimes(1);
});

it('does not deliver any message when a later attachment fails, and permits retry', async () => {
  let attempts = 0;
  const { composer, deliver } = setup({ upload: async () => {
    if (++attempts === 2) throw new Error('Disk full');
    return '/tmp/upload';
  } });
  const image = file();
  composer.edit('%1', 'kept');
  composer.add('%1', 'a', async () => image);
  composer.add('%1', 'b', async () => file('b'));
  await tick();
  await composer.send('%1');
  expect(deliver).not.toHaveBeenCalled();
  expect(composer.draft('%1')).toMatchObject({ text: 'kept', phase: 'idle', message: 'Disk full' });
  expect(image.dispose).not.toHaveBeenCalled();
  await composer.send('%1');
  expect(deliver).toHaveBeenCalledTimes(1);
});

it('cancels before delivery even if an interrupted upload resolves late', async () => {
  const transfer = deferred<string>();
  const { composer, deliver } = setup({ upload: () => transfer.promise });
  composer.add('%1', 'a', async () => file());
  await tick();
  const sending = composer.send('%1');
  composer.interrupt();
  transfer.resolve('/tmp/upload');
  await sending;
  expect(deliver).not.toHaveBeenCalled();
  expect(composer.draft('%1').attachments).toHaveLength(1);
  expect(composer.draft('%1').phase).toBe('idle');
});

it('does not replay an uncertain delivery until the user has checked the Pane', async () => {
  const deliver = jest.fn(async (_text, _signal, started) => { started(); throw new Error('lost reply'); });
  const { composer } = setup({ deliver });
  composer.edit('%1', 'important message');
  await composer.send('%1');
  expect(composer.draft('%1').phase).toBe('uncertain');
  await composer.send('%1');
  expect(deliver).toHaveBeenCalledTimes(1);
  composer.acknowledge('%1');
  await composer.send('%1');
  expect(deliver).toHaveBeenCalledTimes(2);
});

it('blocks duplicate Send and edits during an upload', async () => {
  const transfer = deferred<string>();
  const { composer, deliver } = setup({ upload: () => transfer.promise });
  composer.edit('%1', 'original');
  composer.add('%1', 'a', async () => file());
  await tick();
  const sending = composer.send('%1');
  await composer.send('%1');
  composer.edit('%1', 'changed');
  transfer.resolve('/tmp/upload');
  await sending;
  expect(deliver).toHaveBeenCalledTimes(1);
  expect(deliver.mock.calls[0][0]).toContain('original');
});

it('disposes an attachment whose preparation finishes after removal or closing the Attach', async () => {
  const { composer } = setup();
  const pending = deferred<AttachmentFile>();
  const image = file();
  const released = jest.fn();
  composer.add('%1', 'a', () => pending.promise, released);
  composer.remove('%1', composer.draft('%1').attachments[0].id);
  pending.resolve(image);
  await tick();
  expect(image.dispose).toHaveBeenCalledTimes(1);
  expect(released).toHaveBeenCalledTimes(1);
  expect(composer.draft('%1').attachments).toEqual([]);
  const late = deferred<AttachmentFile>();
  const other = file('other');
  composer.add('%1', 'b', () => late.promise);
  composer.dispose();
  late.resolve(other);
  await tick();
  expect(other.dispose).toHaveBeenCalledTimes(1);
});

it('keeps failed preparations removable and retryable and refuses Send until ready', async () => {
  const { composer, deliver } = setup();
  let attempts = 0;
  composer.add('%1', 'a', async () => {
    if (++attempts === 1) throw new Error('provider unavailable');
    return file();
  });
  await tick();
  await composer.send('%1');
  expect(deliver).not.toHaveBeenCalled();
  const attachment = composer.draft('%1').attachments[0];
  expect(attachment.phase).toBe('failed');
  composer.retry('%1', attachment.id);
  await tick();
  await composer.send('%1');
  expect(deliver).toHaveBeenCalledTimes(1);
});
