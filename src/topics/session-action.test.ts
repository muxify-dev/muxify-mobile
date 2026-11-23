import type { SessionId } from './environment';
import { sessionActions, WINDOW_ACTIONS } from './session-action';

const SESSION = '$3' as SessionId;

it('offers Move to Topic on every Session, and Remove from Topic only on a Session in a Topic', () => {
  expect(sessionActions({ id: SESSION, inTopic: true })).toEqual(['rename-session', 'move-to-topic', 'remove-from-topic', 'kill-session']);
  expect(sessionActions({ id: SESSION, inTopic: false })).toEqual(['rename-session', 'move-to-topic', 'kill-session']);
  expect(WINDOW_ACTIONS).toEqual(['rename-window', 'close-window']);
});
