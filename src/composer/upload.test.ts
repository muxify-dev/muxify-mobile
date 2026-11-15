import type { AttachmentFile } from './types';
import { createUploader } from './upload';

it('writes the same folder on the Host each time it uploads one attachment', async () => {
  const commands: string[] = [];
  const upload = createUploader((command) => {
    commands.push(command);
    return Promise.reject(new Error('the Connection broke'));
  });
  const file: AttachmentFile = {
    id: 'attachment-1',
    uri: 'file:///image.png',
    name: 'image.png',
    size: 3,
    image: true,
    open: () => ({ readBytes: () => new Uint8Array(), close: () => {} }),
    dispose: () => {},
  };

  await expect(upload(file, new AbortController().signal, () => {})).rejects.toThrow('the Connection broke');
  await expect(upload(file, new AbortController().signal, () => {})).rejects.toThrow('the Connection broke');

  expect(commands[0]).toContain('.cache/muxify/attachments/attachment-1"');
  expect(commands[1]).toBe(commands[0]);
});
