import type { ConnectStep } from '@/tmux/attach';
import type { DisconnectKind } from '@/tmux/disconnect-reason';

import { actionsFor, coverOf, type Cover, type CoverAction, type CoverFacts, type Stop } from './cover';
import type { Lookup } from './reconnect';
import type { Typing } from './typing';

const PLACE = { hostName: 'dev-box', session: 'api' };
const reason = (kind: DisconnectKind, detail = 'why') => ({ kind, detail });

/** What a Cover is, in one word a table can hold. */
function shape(cover: Cover): string {
  switch (cover.kind) {
    case 'none':
      return 'none';
    case 'connection-screen': {
      const at = cover.steps?.find((mark) => mark.state === 'at' || mark.state === 'failed');
      return `screen ${cover.title}` +
        (at ? ` @${at.step}${at.state === 'failed' ? ' failed' : ''}` : '') +
        (cover.failure ? `: ${cover.failure.title} [${cover.actions.join(', ')}]` : ` [${cover.actions.join(', ')}]`);
    }
    case 'content':
      switch (cover.notice.kind) {
        case 'none':
          return 'dimmed';
        case 'banner':
          return `dimmed, Banner ${cover.notice.label}`;
        case 'card':
          return `dimmed, card ${cover.notice.failure.title} [${cover.notice.failure.actions.join(', ')}]`;
      }
  }
}

const attach = (typing: Typing, paintedOnce: boolean, step: ConnectStep = 'attaching') => ({ typing, step, paintedOnce });
const facts = (over: Partial<CoverFacts>): CoverFacts => ({ missing: null, lookup: null, attach: null, place: PLACE, ...over });

describe('coverOf', () => {
  it.each<[string, Partial<CoverFacts>, string]>([
    // S12: nothing to attach to.
    ['a Host that is not saved', { missing: 'This Host is no longer saved.' }, 'screen Terminal: This Host is no longer saved. [go-to-hosts]'],
    // S1: a first connect.
    ['before there is an Attach', {}, 'screen Connecting @connecting [go-to-host]'],
    ['connecting', { attach: attach({ kind: 'waiting', for: 'connecting' }, false, 'connecting') }, 'screen Connecting @connecting [go-to-host]'],
    ['signing in', { attach: attach({ kind: 'waiting', for: 'connecting' }, false, 'signing-in') }, 'screen Connecting @signing-in [go-to-host]'],
    ['connected, nothing painted yet', { attach: attach({ kind: 'open' }, false) }, 'screen Connecting @attaching [go-to-host]'],
    ['connected and painted', { attach: attach({ kind: 'open' }, true) }, 'none'],
    // S2: the link drops before the first paint.
    ['reconnecting before the first paint', { attach: attach({ kind: 'waiting', for: 'reconnecting' }, false, 'connecting') }, 'screen Reconnecting @connecting [go-to-host]'],
    ['a retry that failed before the first paint', { attach: attach({ kind: 'stopped', reason: reason('transport-lost') }, false, 'connecting') }, 'screen Connecting @connecting failed: Connection lost [reconnect, go-to-host]'],
    // S3, S4, S10: the link drops while working.
    ['reconnecting over content', { attach: attach({ kind: 'waiting', for: 'reconnecting' }, true, 'connecting') }, 'dimmed, Banner Reconnecting'],
    ['restoring over content', { attach: attach({ kind: 'waiting', for: 'restoring' }, true, 'connecting') }, 'dimmed, Banner Restoring'],
    ['an unreachable Host over content', { attach: attach({ kind: 'stopped', reason: reason('host-unreachable') }, true) }, 'dimmed, card Could not reach dev-box [try-again, edit-host, go-to-host]'],
    // S5: a first connect that fails.
    ['the Identity refused before any paint', { attach: attach({ kind: 'stopped', reason: reason('authentication') }, false, 'signing-in') }, 'screen Connecting @signing-in failed: dev-box did not accept the Identity [edit-host, go-to-host]'],
    // S7: the Session ends.
    ['a Session that ended', { attach: attach({ kind: 'stopped', reason: reason('session-ended') }, true) }, 'dimmed, card api has ended [choose-session, go-to-host]'],
    // S8: a Session switch: the Title Sheet says it, not a Banner.
    ['a Session switch', { attach: attach({ kind: 'waiting', for: 'switching' }, true) }, 'dimmed'],
    // S11: a changed key waits for the user.
    ['a changed key over content', { attach: attach({ kind: 'waiting', for: 'host-key' }, true) }, 'dimmed, card dev-box presented a different host key [accept-key, go-to-host]'],
    ['a changed key before any paint', { attach: attach({ kind: 'waiting', for: 'host-key' }, false) }, 'screen Connecting @attaching failed: dev-box presented a different host key [accept-key, go-to-host]'],
    // S12: Disconnect.
    ['closed on purpose', { attach: attach({ kind: 'stopped', reason: null }, true) }, 'none'],
    ['cancelled by the user', { attach: attach({ kind: 'stopped', reason: reason('user-closed') }, false) }, 'none'],
    ['tmux missing', { attach: attach({ kind: 'stopped', reason: reason('tmux-unavailable') }, true) }, 'dimmed, card tmux is not on dev-box [edit-host, go-to-host]'],
    ['an ending nobody named', { attach: attach({ kind: 'stopped', reason: reason('unknown') }, true) }, 'dimmed, card Disconnected [try-again, go-to-host]'],
  ])('is right for %s', (_, over, expected) => {
    expect(shape(coverOf(facts(over)))).toBe(expected);
  });

  // S6: a cold start reopens the Last Place.
  it.each<[string, Lookup, CoverFacts['attach'], string]>([
    ['looking for the Session', { kind: 'at', step: 'looking-for-session' }, null, 'screen Trying to reconnect @looking-for-session [go-to-host]'],
    ['found, attaching', { kind: 'found' }, attach({ kind: 'waiting', for: 'connecting' }, false, 'signing-in'), 'screen Trying to reconnect @attaching [go-to-host]'],
    ['found, painted', { kind: 'found' }, attach({ kind: 'open' }, true), 'none'],
    ['the Session gone', { kind: 'failed', step: 'looking-for-session', reason: null }, null, 'screen Trying to reconnect @looking-for-session failed: api is no longer on dev-box [choose-session, go-to-host]'],
    ['the key changed', { kind: 'failed', step: 'checking-host-key', fingerprint: 'SHA256:x' }, null, 'screen Trying to reconnect @checking-host-key failed: dev-box presented a different host key [accept-key, go-to-host]'],
    ['the Host unreachable', { kind: 'failed', step: 'connecting', reason: 'timed out' }, null, 'screen Trying to reconnect @connecting failed: Could not reach dev-box [try-again, edit-host, go-to-host]'],
    ['the Attach failing after the visit', { kind: 'found' }, attach({ kind: 'stopped', reason: reason('session-ended') }, false), 'screen Trying to reconnect @attaching failed: api has ended [choose-session, go-to-host]'],
    ['a later drop, once painted', { kind: 'found' }, attach({ kind: 'waiting', for: 'reconnecting' }, true, 'connecting'), 'dimmed, Banner Reconnecting'],
  ])('is right on a cold start, %s', (_, lookup, current, expected) => {
    expect(shape(coverOf(facts({ lookup, attach: current })))).toBe(expected);
  });
});

describe('actionsFor', () => {
  it.each<[Stop, CoverAction[]]>([
    ['transport-lost', ['reconnect', 'go-to-host']],
    ['host-unreachable', ['try-again', 'edit-host', 'go-to-host']],
    ['unknown', ['try-again', 'go-to-host']],
    ['authentication', ['edit-host', 'go-to-host']],
    ['tmux-unavailable', ['edit-host', 'go-to-host']],
    ['host-key', ['go-to-host']],
    ['key-changed', ['accept-key', 'go-to-host']],
    ['session-ended', ['choose-session', 'go-to-host']],
    ['user-closed', ['go-to-host']],
    ['host-missing', ['go-to-hosts']],
  ])('offers the right buttons for %s', (stop, actions) => {
    expect(actionsFor(stop)).toEqual(actions);
  });
});
