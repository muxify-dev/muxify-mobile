import type { SessionId, TopicId } from '@/topics/environment';
import type { TopicDetail } from '@/topics/topic-detail';
import type { Topology } from '@/tmux/topology';
import type { Window } from '@/tmux/tmux-client';

import { countTitleRows, sessionTitleRows, topicTitleRows } from './title-rows';

const window = (over: Partial<Window>): Window => ({
  id: '@0',
  index: 0,
  name: 'shell',
  active: false,
  paneCount: 1,
  zoomed: false,
  command: 'bash',
  ...over,
});

const topology: Topology = {
  windows: [
    window({ id: '@0', index: 0, name: 'shell', command: 'bash' }),
    window({ id: '@1', index: 1, name: 'editor', command: 'nvim', active: true }),
  ],
  panes: [],
};

const topic: TopicDetail = {
  id: 't1' as TopicId,
  label: 'Fix reward drop',
  note: null,
  tags: [],
  state: 'live',
  sessions: [
    {
      id: 's1' as SessionId,
      name: 'gs-backend',
      windows: [
        { id: '@0', index: 0, name: 'shell', mark: null },
        { id: '@1', index: 1, name: 'editor', mark: 'working' },
      ],
    },
    {
      id: 's2' as SessionId,
      name: 'infra',
      windows: [{ id: 'w2', index: 0, name: 'logs', mark: 'done' }],
    },
    { id: 's3' as SessionId, name: 'scratch', windows: null },
  ],
};

describe('sessionTitleRows', () => {
  it('lists every Window with its program, and marks the one on screen', () => {
    expect(sessionTitleRows(topology)).toEqual([
      { kind: 'window', index: 0, name: 'shell', program: 'bash', mark: null, current: false },
      { kind: 'window', index: 1, name: 'editor', program: 'nvim', mark: null, current: true },
    ]);
  });
});

describe('topicTitleRows', () => {
  const rows = topicTitleRows(topic, { session: 'gs-backend', topology });

  it('keeps the Mac\'s order of Sessions and marks the attached one', () => {
    expect(rows.map((row) => [row.kind === 'session' && row.name, row.current])).toEqual([
      ['gs-backend', true],
      ['infra', false],
      ['scratch', false],
    ]);
  });

  it('gives the attached Session\'s Windows the program and the active mark from the Topology', () => {
    expect(rows[0].kind === 'session' && rows[0].windows).toEqual([
      { kind: 'window', index: 0, name: 'shell', program: 'bash', mark: null, current: false },
      { kind: 'window', index: 1, name: 'editor', program: 'nvim', mark: 'working', current: true },
    ]);
  });

  it('shows another Session\'s Windows with the Agent mark and no program', () => {
    expect(rows[1].kind === 'session' && rows[1].windows).toEqual([
      { kind: 'window', index: 0, name: 'logs', program: null, mark: 'done', current: false },
    ]);
  });

  it('lists a Session the Mac has not described yet as a row with no Windows', () => {
    expect(rows[2].kind === 'session' && rows[2].windows).toEqual([]);
  });

  it('counts the Sessions and their Windows as the rows the sheet draws', () => {
    expect(countTitleRows(rows)).toBe(6);
    expect(countTitleRows(sessionTitleRows(topology))).toBe(2);
  });
});


it('uses the current Topology Window set and keeps marks by id after reindexing', () => {
  const rows = topicTitleRows(topic, { session: 'gs-backend', topology: {
    windows: [window({ id: '@1', index: 4, name: 'renamed' }), window({ id: '@new', index: 5, name: 'new' })], panes: [],
  } });
  expect(rows[0].kind === 'session' && rows[0].windows.map((row) => [row.index, row.name, row.mark])).toEqual([
    [4, 'renamed', 'working'], [5, 'new', null],
  ]);
});

it('shows a newly added Session before the Topic read contains it', () => {
  const rows = topicTitleRows(topic, { session: 'just-added', topology });
  expect(rows.at(-1)).toEqual({ kind: 'session', name: 'just-added', current: true, windows: sessionTitleRows(topology) });
});
