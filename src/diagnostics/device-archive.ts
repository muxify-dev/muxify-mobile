import { Directory, File, Paths } from 'expo-file-system';
import { createLogArchive, type Launch, type LogFiles } from './archive';

export function deviceArchive(launch: Launch) {
  const directory = () => {
    const folder = new Directory(Paths.document, 'muxify-logs');
    if (!folder.exists) folder.create({ intermediates: true, idempotent: true });
    return folder;
  };
  const files: LogFiles = {
    names: () => directory().list().filter((entry) => entry instanceof File).map((entry) => entry.name),
    read: (name) => new File(directory(), name).textSync(),
    write: (name, text) => new File(directory(), name).write(text),
    append(name, text) {
      const handle = new File(directory(), name).open();
      try {
        handle.offset = handle.size;
        handle.writeBytes(new TextEncoder().encode(text));
      } finally { handle.close(); }
    },
    remove: (name) => new File(directory(), name).delete(),
  };
  return createLogArchive(files, launch);
}
