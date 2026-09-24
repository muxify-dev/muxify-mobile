import { hostSessions } from './host-sessions';
import type { RecentSession } from '@/storage/records';
import type { Session } from '@/tmux/tmux-client';

const remembered = (name: string, lastOpenedAt: string): RecentSession => ({
  hostId: 'host1',
  name,
  lastOpenedAt,
});

const running = (name: string, attached = false): Session => ({
  name,
  windowCount: 1,
  attached,
});

describe('hostSessions', () => {
  it('keeps a Session out of Available once it is remembered', () => {
    // One Session, one row: two ways to open the same thing is a list that
    // lies about how many Sessions the Host has.
    const { recent, available } = hostSessions(
      [remembered('muxify', '2026-09-15T10:00:00Z')],
      [running('muxify'), running('cook')],
    );

    expect(recent.map((row) => row.name)).toEqual(['muxify']);
    expect(available.map((row) => row.name)).toEqual(['cook']);
  });

  it('keeps the order it was given for Recent, and sorts Available by name', () => {
    const { recent, available } = hostSessions(
      [remembered('zebra', '2026-09-15T11:00:00Z'), remembered('alpha', '2026-09-15T09:00:00Z')],
      [running('zebra'), running('alpha'), running('game_server'), running('aws_terraform')],
    );

    expect(recent.map((row) => row.name)).toEqual(['zebra', 'alpha']);
    expect(available.map((row) => row.name)).toEqual(['aws_terraform', 'game_server']);
  });

  it('carries the attached flag onto the remembered row', () => {
    const { recent } = hostSessions(
      [remembered('muxify', '2026-09-15T10:00:00Z')],
      [running('muxify', true)],
    );

    expect(recent[0].attached).toBe(true);
  });

  it('hides a remembered Session the Host no longer has', () => {
    const { recent, available } = hostSessions(
      [remembered('gone', '2026-09-15T10:00:00Z'), remembered('here', '2026-09-15T09:00:00Z')],
      [running('here')],
    );

    expect(recent.map((row) => row.name)).toEqual(['here']);
    expect(available).toEqual([]);
  });

  it('shows everything remembered until a listing has actually succeeded', () => {
    // Failing open is the whole point: an unreachable Host is exactly when you
    // most want to see what you had open on it.
    const { recent, available } = hostSessions(
      [remembered('muxify', '2026-09-15T10:00:00Z'), remembered('cook', '2026-09-15T09:00:00Z')],
      undefined,
    );

    expect(recent.map((row) => row.name)).toEqual(['muxify', 'cook']);
    expect(recent.every((row) => row.attached === undefined)).toBe(true);
    expect(available).toEqual([]);
  });

  it('reads a Host with nothing running as no Sessions at all', () => {
    const { recent, available } = hostSessions([remembered('gone', '2026-09-15T10:00:00Z')], []);

    expect(recent).toEqual([]);
    expect(available).toEqual([]);
  });

  it('lists a Host that has Sessions nobody here has opened', () => {
    const { recent, available } = hostSessions([], [running('cook'), running('aws_terraform')]);

    expect(recent).toEqual([]);
    expect(available.map((row) => row.name)).toEqual(['aws_terraform', 'cook']);
  });
});
