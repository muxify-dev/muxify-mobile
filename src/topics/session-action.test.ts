import type { SessionId } from './environment';
import { sessionActions, WINDOW_ACTIONS } from './session-action';

const SESSION = '$3' as SessionId;

it('offers Remove from Topic only for a Session in a Topic', () => {
  expect(sessionActions({ id: SESSION, inTopic: true })).toEqual(['rename-session', 'remove-from-topic', 'kill-session']);
  expect(sessionActions({ id: SESSION, inTopic: false })).toEqual(['rename-session', 'kill-session']);
  expect(WINDOW_ACTIONS).toEqual(['rename-window', 'close-window']);
});
