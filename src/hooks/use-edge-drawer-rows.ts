import { useEffect, useMemo, useState } from 'react';

import { readBrowserTabs } from '@/browser/read-browser-tabs';
import type { BrowserTab } from '@/browser/tabs';
import { deviceLog } from '@/diagnostics/device-log';
import { speakingAs } from '@/diagnostics/log';
import { destinationRows, listedWindows, type DestinationRow, type OnScreen } from '@/domain/destinations';
import type { TitleRow } from '@/domain/title-rows';
import type { Attach, AttachState } from '@/tmux/attach';
import { useAttachHolder } from '@/tmux/attach-context';
import type { TopicDetail } from '@/topics/topic-detail';

const say = speakingAs(deviceLog(), 'screen');

/**
 * What the Edge Drawer lists while it is open, for useTitleSheet.
 *
 * Each time it opens it reads the Tabs of every Window it lists, one read per
 * Window, and shows each Window's Tabs as they arrive (D4). A read that
 * fails, or comes back after the drawer closed or the Attach changed, shows
 * nothing.
 *
 * It writes to the log which row it marks as on screen, each time that
 * changes while it is open: the drawer closes at each lift, so the e2e reads
 * the mark there.
 */
export function useEdgeDrawerRows({ open, revision, attach, state, hostId, topic, titleRows, onScreen }: {
  open: boolean;
  /** The chooser's revision while it is open, which each read is checked against. */
  revision: number | null;
  attach: Attach | null;
  state: AttachState | null;
  hostId: string | undefined;
  topic: TopicDetail | null;
  titleRows: TitleRow[];
  onScreen: OnScreen;
}) {
  const holder = useAttachHolder();
  const [tabs, setTabs] = useState<{ revision: number; byWindow: ReadonlyMap<string, BrowserTab[]> } | null>(null);

  const windowsKey = open ? listedWindows(titleRows).join(' ') : '';
  useEffect(() => {
    if (!open || revision === null || !hostId || windowsKey === '') return;
    let current = true;
    for (const window of windowsKey.split(' ')) {
      void readBrowserTabs(hostId, window).then((read) => {
        if (!current || holder.current() !== attach || read.kind !== 'listed' || read.tabs.length === 0) return;
        setTabs((previous) => {
          const byWindow = new Map(previous?.revision === revision ? previous.byWindow : []);
          byWindow.set(window, read.tabs);
          return { revision, byWindow };
        });
      });
    }
    return () => { current = false; };
  }, [open, revision, hostId, windowsKey, attach, holder]);

  const rows = useMemo((): DestinationRow[] => {
    if (!open || !state) return [];
    return destinationRows({
      topic: state.topic ? topic?.label ?? null : null,
      rows: titleRows,
      attachedSession: state.sessionName,
      panes: state.topology.panes,
      tabs: tabs?.revision === revision ? tabs.byWindow : NO_TABS,
      onScreen,
    });
  }, [open, state, topic, titleRows, tabs, revision, onScreen]);

  const hereKey = rows.find((row) => 'here' in row && row.here)?.key ?? null;
  useEffect(() => {
    if (open) say(`the Edge Drawer marks ${hereKey ?? 'no row'} as on screen`);
  }, [open, hereKey]);

  return rows;
}

const NO_TABS: ReadonlyMap<string, BrowserTab[]> = new Map();
