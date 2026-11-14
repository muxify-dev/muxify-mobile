import { parseSettings } from '@/settings/settings';
import { chordFor, chordLabel, rebind, type RecordedKey } from './keyboard-shortcuts';

const press = (key: string, held: Partial<Omit<RecordedKey, 'key'>> = {}): RecordedKey => ({
  key, command: true, shift: false, option: false, control: false, ...held,
});

describe('Keyboard Shortcuts', () => {
  it('starts with the defaults', () => {
    expect(chordLabel(chordFor(undefined, 'open-settings'))).toBe('⌘,');
    expect(chordLabel(chordFor(undefined, 'split-down'))).toBe('⇧⌘D');
    expect(chordLabel(chordFor(undefined, 'pane-left'))).toBe('⇧⌘H');
  });

  it('gives an action a new key, and keeps it across a save', () => {
    const result = rebind(undefined, 'pane-left', press('h'));
    if (result.kind !== 'bound') throw new Error(result.kind);
    const saved = parseSettings(JSON.parse(JSON.stringify({ keyboardShortcuts: result.shortcuts })));
    expect(chordLabel(chordFor(saved.keyboardShortcuts, 'pane-left'))).toBe('⌘H');
    expect(chordLabel(chordFor(saved.keyboardShortcuts, 'pane-right'))).toBe('⇧⌘L');
  });

  it('refuses a key without ⌘, which would be the Pane’s', () => {
    expect(rebind(undefined, 'pane-left', press('h', { command: false, control: true })).kind).toBe('no-command');
  });

  it('refuses a key another action has', () => {
    expect(rebind(undefined, 'pane-left', press('d'))).toEqual({ kind: 'taken', by: 'split-right' });
  });

  it('forgets a change set back to the default', () => {
    const changed = rebind(undefined, 'split-right', press('e'));
    if (changed.kind !== 'bound') throw new Error(changed.kind);
    expect(rebind(changed.shortcuts, 'split-right', press('d'))).toEqual({ kind: 'bound', shortcuts: {} });
  });

  it('drops a saved key it cannot read', () => {
    expect(parseSettings({ keyboardShortcuts: { 'pane-up': { key: 3 }, nope: { key: 'x' } } }).keyboardShortcuts)
      .toBeUndefined();
  });
});
