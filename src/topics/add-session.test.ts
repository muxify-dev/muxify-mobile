import { freeSessionName } from './add-session';
import type { EnvironmentSnapshot, SessionId, TopicId } from './environment';
import type { SessionPathChoice } from './session-paths';

const TOPIC = 't1' as TopicId;

function snapshot(sessions: [name: string, topic: string | null][]): EnvironmentSnapshot {
  return {
    tags: [],
    sessions: sessions.map(([name, topic], index) => ({
      id: `$${index}` as SessionId,
      name,
      activity: 0,
      mark: null,
      topic: topic as TopicId | null,
      windows: null,
    })),
    pinned: [],
    unpinned: { limit: 3, places: [], guests: [], bench: [] },
    no_topic: [],
  };
}

function choice(name: string, directory: string): SessionPathChoice {
  return { kind: 'session_path', name, label: name, directory, worktree: null, inThisTopic: false, alsoIn: [] };
}

describe('the Session name that the phone picks for Add a Session', () => {
  it('is the name of the Session Path at the folder', () => {
    expect(freeSessionName('/code/gs', [choice('game_server', '/code/gs')], snapshot([]), TOPIC)).toBe('game_server');
  });

  it('is the last part of a typed folder, as tmux takes it', () => {
    expect(freeSessionName('~/Dev/my project.v2/', [], snapshot([]), TOPIC)).toBe('myproject_v2');
  });

  it('gets +2 when the Topic has a Session with the name, so a second Session at one folder is a new one', () => {
    const live = snapshot([['game_server/fix-login', TOPIC]]);

    expect(freeSessionName('/code/gs', [choice('game_server', '/code/gs')], live, TOPIC)).toBe('game_server+2');
  });

  it('takes the first free number', () => {
    const live = snapshot([
      ['game_server/fix-login', TOPIC],
      ['game_server+2/fix-login', TOPIC],
    ]);

    expect(freeSessionName('/code/gs', [choice('game_server', '/code/gs')], live, TOPIC)).toBe('game_server+3');
  });

  it('does not count the Sessions of other Topics', () => {
    const live = snapshot([
      ['game_server/other-topic', 't2'],
      ['game_server', null],
    ]);

    expect(freeSessionName('/code/gs', [choice('game_server', '/code/gs')], live, TOPIC)).toBe('game_server');
  });
});
