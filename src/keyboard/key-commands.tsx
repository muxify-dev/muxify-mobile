import { requireNativeView, requireOptionalNativeModule } from 'expo';
import { useFocusEffect } from 'expo-router';
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { Platform, type ViewProps } from 'react-native';

import { deviceLog } from '@/diagnostics/device-log';
import { speakingAs } from '@/diagnostics/log';
import { useSettings } from '@/settings/settings-context';
import {
  chordFor,
  KEYBOARD_ACTION_TITLES,
  KEYBOARD_ACTIONS,
  type KeyboardAction,
  type KeyChord,
  type RecordedKey,
} from './keyboard-shortcuts';

interface NativeKeyCommand extends KeyChord {
  id: KeyboardAction;
  title: string;
}

interface KeyCommandsModule {
  setCommands(commands: NativeKeyCommand[]): void;
  addListener(event: 'onCommand', listener: (event: { id: string }) => void): { remove(): void };
}

const keyCommands = Platform.OS === 'ios'
  ? requireOptionalNativeModule<KeyCommandsModule>('KeyCommands')
  : null;

if (Platform.OS === 'ios' && !keyCommands) {
  throw new Error('KeyCommands is unavailable. Rebuild the iOS app to include the native module.');
}

const say = speakingAs(deviceLog(), 'keyboard');

export type KeyboardHandlers = Partial<Record<KeyboardAction, () => void>>;

interface Registration {
  current: KeyboardHandlers;
}

interface KeyCommandsContextValue {
  register: (registration: Registration) => () => void;
  /** Runs an action as its key would, for the Key Row's ⌘. */
  run: (action: KeyboardAction) => void;
}

const KeyCommandsContext = createContext<KeyCommandsContextValue | null>(null);

/**
 * Gives iOS a key command for each Keyboard Shortcut some mounted screen
 * handles, with the chord the user chose, and runs that screen's handler when
 * one is pressed.
 *
 * Only the handled ones go to iOS, so holding ⌘ on an iPad lists what works
 * on this screen, and a key nobody handles still reaches the Pane. When two
 * screens handle one action, the one registered last runs.
 */
export function KeyCommandsProvider({ children }: { children: React.ReactNode }) {
  const { settings } = useSettings();
  const registrations = useRef<Registration[]>([]);
  const [revision, setRevision] = useState(0);

  const register = useCallback((registration: Registration) => {
    registrations.current = [...registrations.current, registration];
    setRevision((value) => value + 1);
    return () => {
      registrations.current = registrations.current.filter((each) => each !== registration);
      setRevision((value) => value + 1);
    };
  }, []);

  const run = useCallback((action: KeyboardAction) => {
    const handler = registrations.current.findLast((each) => each.current[action])?.current[action];
    say(`keyboard shortcut ${action}${handler ? '' : ' has no handler'}`);
    handler?.();
  }, []);

  useEffect(() => {
    if (!keyCommands) return;
    const subscription = keyCommands.addListener('onCommand', ({ id }) => {
      const action = KEYBOARD_ACTIONS.find((each) => each === id);
      if (action !== undefined) run(action);
    });
    return () => subscription.remove();
  }, [run]);

  const shortcuts = settings.keyboardShortcuts;
  useEffect(() => {
    const handled = KEYBOARD_ACTIONS.filter((action) =>
      registrations.current.some((each) => each.current[action] !== undefined));
    keyCommands?.setCommands(handled.map((action) => ({
      id: action,
      title: KEYBOARD_ACTION_TITLES[action],
      ...chordFor(shortcuts, action),
    })));
  }, [revision, shortcuts]);

  const value = useMemo(() => ({ register, run }), [register, run]);
  return <KeyCommandsContext.Provider value={value}>{children}</KeyCommandsContext.Provider>;
}

function useRegistration(handlers: KeyboardHandlers): [Registration, string] {
  const handlersRef = useRef(handlers);
  useLayoutEffect(() => {
    handlersRef.current = handlers;
  });
  // Which actions are handled, so a new handler for the same actions does not
  // register again on every render.
  const actions = KEYBOARD_ACTIONS.filter((action) => handlers[action] !== undefined).join(' ');
  return [handlersRef, actions];
}

function useKeyCommands(): KeyCommandsContextValue {
  const value = useContext(KeyCommandsContext);
  if (!value) throw new Error('Keyboard Shortcuts need a KeyCommandsProvider above them');
  return value;
}

/** Runs a Keyboard Shortcut's action on whichever screen handles it. */
export function useRunKeyboardShortcut(): (action: KeyboardAction) => void {
  return useKeyCommands().run;
}

/** Handles Keyboard Shortcuts for as long as the caller is mounted. */
export function useKeyboardShortcuts(handlers: KeyboardHandlers): void {
  const { register } = useKeyCommands();
  const [registration, actions] = useRegistration(handlers);
  useEffect(() => register(registration), [register, registration, actions]);
}

/**
 * Handles Keyboard Shortcuts while the caller's screen is on top. A screen
 * under Settings stays mounted, and ⌘D there must not split a Pane nobody
 * can see.
 */
export function useScreenKeyboardShortcuts(handlers: KeyboardHandlers): void {
  const { register } = useKeyCommands();
  const [registration, actions] = useRegistration(handlers);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `actions` stands for the handler set.
  useFocusEffect(useCallback(() => register(registration), [register, registration, actions]));
}

interface KeyRecorderProps extends ViewProps {
  /** While true, the next key pressed is recorded and no Keyboard Shortcut runs. */
  active: boolean;
  onRecord: (event: { nativeEvent: RecordedKey }) => void;
  /** Escape was pressed on its own. */
  onCancel: () => void;
}

export const KeyRecorder = (Platform.OS === 'ios'
  ? requireNativeView('KeyCommands', 'KeyRecorderView')
  : () => null) as ComponentType<KeyRecorderProps>;
