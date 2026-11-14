import { Stack } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Form, Host, HStack, Section, Spacer, Text } from '@expo/ui/swift-ui';
import {
  accessibilityLabel,
  background,
  buttonStyle,
  environment,
  font,
  foregroundColor,
  frame,
  listRowBackground,
  monospacedDigit,
  scrollContentBackground,
  tint,
} from '@expo/ui/swift-ui/modifiers';

import { SectionHeader } from '@/components/section-header';
import { TAPPABLE_ROW } from '@/components/tappable-row';
import { KeyRecorder } from '@/keyboard/key-commands';
import {
  chordFor,
  chordLabel,
  KEYBOARD_ACTION_TITLES,
  KEYBOARD_ACTIONS,
  rebind,
  type KeyboardAction,
  type RecordedKey,
} from '@/keyboard/keyboard-shortcuts';
import { useSettings } from '@/settings/settings-context';

/**
 * The Keyboard Shortcuts, each with its key. A tap on a row waits for the
 * next key pressed on a hardware keyboard and gives it to that action.
 */
export default function KeyboardShortcutsScreen() {
  const { settings, update, appearance, palette } = useSettings();
  const [recording, setRecording] = useState<KeyboardAction | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const shortcuts = settings.keyboardShortcuts;

  const record = (key: RecordedKey) => {
    if (recording === null) return;
    const result = rebind(shortcuts, recording, key);
    if (result.kind === 'no-command') {
      setProblem('A Keyboard Shortcut needs ⌘. Without it, the key would not reach the Pane.');
      return;
    }
    if (result.kind === 'taken') {
      setProblem(`${chordLabel(key)} is ${KEYBOARD_ACTION_TITLES[result.by]}.`);
      return;
    }
    update({ keyboardShortcuts: result.shortcuts });
    setRecording(null);
    setProblem(null);
  };

  const footer = recording === null
    ? 'Tap a shortcut, then press the new keys on the hardware keyboard. Escape cancels.'
    : problem ?? `Press the keys for ${KEYBOARD_ACTION_TITLES[recording]}. Escape cancels.`;

  return (
    <View style={styles.fill}>
      <Stack.Screen options={{ title: 'Keyboard Shortcuts' }} />
      <KeyRecorder
        style={styles.recorder}
        active={recording !== null}
        onRecord={({ nativeEvent }) => record(nativeEvent)}
        onCancel={() => {
          setRecording(null);
          setProblem(null);
        }}
      />
      <Host style={styles.fill} matchContents={false}>
        <Form
          modifiers={[
            environment('colorScheme', appearance),
            scrollContentBackground('hidden'),
            background(palette.background),
            tint(palette.controlAccent),
          ]}>
          <Section
            header={<SectionHeader palette={palette}>Hardware keyboard</SectionHeader>}
            footer={
              <Text modifiers={[font({ size: 13 }), foregroundColor(palette.sectionHeader)]}>
                {footer}
              </Text>
            }
            modifiers={[listRowBackground(palette.rowSurface)]}>
            {KEYBOARD_ACTIONS.map((action) => {
              const listening = recording === action;
              const label = listening ? 'Press keys…' : chordLabel(chordFor(shortcuts, action));
              return (
                <Button
                  key={action}
                  onPress={() => {
                    setProblem(null);
                    setRecording(listening ? null : action);
                  }}
                  modifiers={[
                    buttonStyle('plain'),
                    accessibilityLabel(`${KEYBOARD_ACTION_TITLES[action]}, ${label}`),
                  ]}>
                  <HStack modifiers={[frame({ maxWidth: 3000 }), TAPPABLE_ROW]}>
                    <Text>{KEYBOARD_ACTION_TITLES[action]}</Text>
                    <Spacer />
                    <Text
                      modifiers={[
                        monospacedDigit(),
                        foregroundColor(listening ? palette.controlAccent : palette.secondaryLabel),
                      ]}>
                      {label}
                    </Text>
                  </HStack>
                </Button>
              );
            })}
          </Section>

          {shortcuts !== undefined && (
            <Section modifiers={[listRowBackground(palette.rowSurface)]}>
              <Button
                label="Restore defaults"
                onPress={() => {
                  setRecording(null);
                  setProblem(null);
                  update({ keyboardShortcuts: undefined });
                }}
              />
            </Section>
          )}
        </Form>
      </Host>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  recorder: { position: 'absolute', width: 1, height: 1, opacity: 0 },
});
