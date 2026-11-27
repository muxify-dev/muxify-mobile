import { useEffect } from 'react';

import { deviceHostStore } from '@/storage/device-store';
import type { Tag } from '@/topics/environment';
import { pushedListing } from '@/topics/host-writes';

import { useHostRead, type HostReadHandle } from './use-host-read';

/**
 * The Tags of the Host's Config, read when a sheet opens, for the Tag
 * choices of New Topic and Edit Topic. A Host Read: the sheet shows that it
 * runs, and Try again asks again.
 */
export function useConfigTags(hostId: string): HostReadHandle<string, Tag[]> {
  const read = useHostRead<string, Tag[]>({
    read: async (id, signal) => {
      const host = (await deviceHostStore().load()).hosts.find((entry) => entry.id === id);
      if (!host) throw new Error('This Host is no longer saved.');
      return (await pushedListing(host, signal)).tags;
    },
  });
  const { ask } = read;
  useEffect(() => ask(hostId), [ask, hostId]);
  return read;
}
