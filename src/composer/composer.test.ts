import type { MessageId } from '@/tmux/input-lane';

import { createComposer } from './composer';
import type { AttachmentFile, ComposerDestination } from './types';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function file(name = 'image.png'): AttachmentFile {
  return { id: `id-${name}`, uri: `file:///${name}`, name, size: 10, image: true,
    open: () => { throw new Error('unused'); }, dispose: jest.fn() };
}

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

function setup(over: Partial<ComposerDestination> = {}) {
  const deliver = jest.fn((_text: string, _id: MessageId) => {});
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
  composer.settle('%1', deliver.mock.calls[0][1], { kind: 'delivered' });
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
  expect(composer.draft('%1')).toMatchObject({ text: 'kept', phase: { kind: 'idle' }, message: 'Disk full' });
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
  expect(composer.draft('%1').phase).toEqual({ kind: 'idle' });
});

it('hands the message to the Pane once, after the uploads', async () => {
  const transfer = deferred<string>();
  const { composer, deliver } = setup({ upload: () => transfer.promise });
  composer.edit('%1', 'important message');
  composer.add('%1', 'a', async () => file());
  await tick();
  const sending = composer.send('%1');
  await tick();
  expect(deliver).not.toHaveBeenCalled();
  expect(composer.draft('%1')).toMatchObject({ text: 'important message', phase: { kind: 'uploading' } });
  transfer.resolve('/tmp/upload');
  await sending;
  expect(deliver.mock.calls).toEqual([["important message\n'/tmp/upload'", expect.any(String)]]);
  await composer.send('%1');
  expect(deliver).toHaveBeenCalledTimes(1);
});

describe('a message in the Lane', () => {
  async function sent() {
    const run = setup();
    const image = file();
    run.composer.edit('%1', 'ls -la');
    run.composer.add('%1', 'a', async () => image);
    await tick();
    await run.composer.send('%1');
    return { ...run, image, id: run.deliver.mock.calls[0][1] };
  }

  it('keeps the Draft, and takes no edit and no second Send, until the Lane settles it', async () => {
    const { composer, deliver, image } = await sent();
    expect(composer.draft('%1')).toMatchObject({ text: 'ls -la', phase: { kind: 'sending' } });
    composer.edit('%1', 'changed');
    await composer.send('%1');
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(composer.draft('%1').text).toBe('ls -la');
    expect(image.dispose).not.toHaveBeenCalled();
  });

  it('clears the Draft when tmux confirms the message on the Pane', async () => {
    const { composer, image, id } = await sent();
    composer.settle('%1', id, { kind: 'delivered' });
    expect(composer.draft('%1')).toMatchObject({ text: '', attachments: [], phase: { kind: 'idle' } });
    expect(image.dispose).toHaveBeenCalledTimes(1);
  });

  it('keeps a discarded message as a Draft that can be edited and sent again, and says why', async () => {
    const { composer, deliver, image, id } = await sent();
    composer.settle('%1', id, { kind: 'discarded', reason: 'pane-gone' });
    expect(composer.draft('%1')).toMatchObject({
      text: 'ls -la',
      attachments: [expect.objectContaining({ phase: 'ready' })],
      phase: { kind: 'idle' },
      message: 'Not sent: the Pane is gone. The Draft is kept.',
    });
    expect(image.dispose).not.toHaveBeenCalled();
    composer.edit('%1', 'ls');
    await composer.send('%1');
    expect(deliver.mock.calls[1][0]).toBe("ls\n'/home/me/image.png'");
    expect(deliver.mock.calls[1][1]).not.toBe(id);
  });

  it('gives the Draft back for edits when the user takes the message from the Lane', async () => {
    const { composer, id } = await sent();
    composer.settle('%1', id, { kind: 'taken' });
    composer.edit('%1', 'ls -l');
    expect(composer.draft('%1')).toMatchObject({ text: 'ls -l', phase: { kind: 'idle' } });
  });

  it('does not change for the fate of another message', async () => {
    const { composer } = await sent();
    composer.settle('%1', 'other' as MessageId, { kind: 'delivered' });
    expect(composer.draft('%1')).toMatchObject({ text: 'ls -la', phase: { kind: 'sending' } });
  });
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

describe('moving a Draft to another Pane', () => {
  it('fills an empty Draft with the text and attachments, and empties the Draft it came from', async () => {
    const { composer } = setup();
    const image = file();
    composer.edit('%5', 'deploy');
    composer.add('%5', image.name, async () => image);
    await tick();

    expect(composer.move('%5', '%1')).toBe(true);
    expect(composer.draft('%1')).toMatchObject({ text: 'deploy', attachments: [{ name: image.name, phase: 'ready' }] });
    expect(composer.draft('%5')).toMatchObject({ text: '', attachments: [] });
    expect(image.dispose).not.toHaveBeenCalled();
  });

  it('puts the text on a new line after the text the Draft has', () => {
    const { composer } = setup();
    composer.edit('%1', 'echo');
    composer.edit('%5', 'deploy');
    expect(composer.move('%5', '%1')).toBe(true);
    expect(composer.draft('%1').text).toBe('echo\ndeploy');
  });

  it('moves nothing into a Draft that takes no edit', async () => {
    const { composer } = setup({ upload: () => new Promise<string>(() => {}) });
    composer.add('%1', 'a', async () => file());
    await tick();
    void composer.send('%1');
    composer.edit('%5', 'deploy');
    expect(composer.move('%5', '%1')).toBe(false);
    expect(composer.draft('%5').text).toBe('deploy');
  });
});
