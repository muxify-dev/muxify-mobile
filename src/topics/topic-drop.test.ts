import type { TopicId } from './environment';
import { dropCommand, type Drop } from './topic-drop';

const ID = '5a11abd7-0f6d-4f18-acbc-d1fa100b87e6' as TopicId;

describe('the command of a drop', () => {
  it.each<[Drop, string]>([
    [{ kind: 'place', side: 'before', anchor: { kind: 'topic', id: ID } }, `topic move --before '${ID}'`],
    [{ kind: 'place', side: 'after', anchor: { kind: 'topic', id: ID } }, `topic move --after '${ID}'`],
    [
      { kind: 'place', side: 'before', anchor: { kind: 'locked-session', name: "gs/it's" } },
      `topic move --before-session 'gs/it'\\''s'`,
    ],
    [
      { kind: 'place', side: 'after', anchor: { kind: 'locked-session', name: 'gs/fix' } },
      `topic move --after-session 'gs/fix'`,
    ],
    [
      { kind: 'place', side: 'before', anchor: { kind: 'open-place', id: 'open-place-2' } },
      `topic move --before-place 'open-place-2'`,
    ],
    [
      { kind: 'place', side: 'after', anchor: { kind: 'open-place', id: 'open-place-2' } },
      `topic move --after-place 'open-place-2'`,
    ],
    [{ kind: 'trade', with: { kind: 'topic', id: ID } }, `topic move --trade-with '${ID}'`],
    [
      { kind: 'trade', with: { kind: 'locked-session', name: 'gs/fix' } },
      `topic move --trade-with-session 'gs/fix'`,
    ],
    [{ kind: 'fill', place: 2 }, 'topic fill-place 2'],
  ])('%j is %s', (drop, command) => {
    expect(dropCommand(drop)).toBe(command);
  });
});
