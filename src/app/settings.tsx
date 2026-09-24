import { Stack } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  Form,
  Host,
  HStack,
  Picker,
  Section,
  Spacer,
  Stepper,
  Text,
  Toggle,
  VStack,
} from '@expo/ui/swift-ui';
import {
  background,
  clipShape,
  cornerRadius,
  disabled,
  environment,
  fixedSize,
  font,
  foregroundColor,
  frame,
  listRowBackground,
  monospacedDigit,
  padding,
  pickerStyle,
  scrollContentBackground,
  tag,
  tint,
} from '@expo/ui/swift-ui/modifiers';

import { AppPalette, Themes, THEME_IDS, type ThemeId } from '@/constants/app-theme';
import { deviceSettingsStore } from '@/settings/device-settings';
import {
  DEFAULT_EXPLICIT_FONT_SIZE,
  DEFAULT_SETTINGS,
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
  type Settings,
} from '@/settings/settings';

/** The few lines of code the Theme preview shows. */
const PREVIEW_LINES: { number: string; text: string }[] = [
  { number: '1', text: '#include <iostream>' },
  { number: '2', text: '' },
  { number: '3', text: 'int main() {' },
  { number: '4', text: '  std::cout << "muxify";' },
  { number: '5', text: '}' },
];

/**
 * The Settings screen: a native grouped Form, pushed onto the stack.
 *
 * Every control here is the system's own — Toggle, Stepper, segmented Picker —
 * rather than something hand-built to look like it. They behave exactly as they
 * do everywhere else on the phone, which is the whole argument for using them.
 *
 * Saved on every change rather than behind a Done button: there is nothing here
 * that is half-entered, so there is nothing to confirm.
 */
export default function SettingsScreen() {
  const [settings, setSettings] = useState<Settings | null>(null);

  useEffect(() => {
    void (async () => setSettings(await deviceSettingsStore().load()))();
  }, []);

  const update = useCallback((change: Partial<Settings>) => {
    setSettings((current) => {
      if (!current) return current;
      const next = { ...current, ...change };
      void deviceSettingsStore().save(next);
      return next;
    });
  }, []);

  const value = settings ?? DEFAULT_SETTINGS;
  const usesDefaultSize = value.fontSize === null;
  const shownSize = value.fontSize ?? DEFAULT_EXPLICIT_FONT_SIZE;
  const theme = Themes[value.theme];

  return (
    <View style={styles.fill}>
      <Stack.Screen options={{ title: 'Settings' }} />
      <Host style={styles.fill} matchContents={false}>
        <Form
          modifiers={[
            // Dark whatever the phone is set to: SwiftUI reads the system
            // appearance, not React Navigation's theme, so a phone in light
            // mode renders black labels on this dark ground.
            environment('colorScheme', 'dark'),
            // The Form paints its own grouped background, which is the system
            // grey; the app is darker than that everywhere else.
            scrollContentBackground('hidden'),
            background(AppPalette.background),
            tint(AppPalette.controlAccent),
          ]}>
          <Section
            header={<SectionHeader>Font</SectionHeader>}
            modifiers={[listRowBackground(AppPalette.rowSurface)]}>
            <Toggle
              label="Use default size"
              isOn={usesDefaultSize}
              onIsOnChange={(on) =>
                update({ fontSize: on ? null : DEFAULT_EXPLICIT_FONT_SIZE })
              }
              modifiers={[tint(AppPalette.controlAccent)]}
            />

            <HStack modifiers={[frame({ maxWidth: 3000 }), disabled(usesDefaultSize)]}>
              <Text>Font size</Text>
              <Spacer />
              <Text
                modifiers={[
                  monospacedDigit(),
                  foregroundColor(
                    usesDefaultSize ? AppPalette.secondaryLabel : AppPalette.toolbarTint,
                  ),
                  padding({ trailing: 12 }),
                ]}>
                {String(shownSize)}
              </Text>
              {/* An unlabelled Stepper is just the minus and plus, which is
                  what sits at the end of the row. */}
              <Stepper
                label=""
                value={shownSize}
                min={MIN_FONT_SIZE}
                max={MAX_FONT_SIZE}
                step={1}
                onValueChange={(next) => update({ fontSize: next })}
                // Without this the Stepper eats the whole row and the Spacer
                // above it has nothing left to push the value across with.
                modifiers={[fixedSize({ horizontal: true, vertical: false })]}
              />
            </HStack>
          </Section>

          <Section
            header={<SectionHeader>Theme</SectionHeader>}
            modifiers={[listRowBackground(AppPalette.rowSurface)]}>
            <Picker
              label=""
              selection={value.theme}
              onSelectionChange={(next) => update({ theme: next as ThemeId })}
              modifiers={[pickerStyle('segmented')]}>
              {THEME_IDS.map((id) => (
                <Text key={id} modifiers={[tag(id)]}>
                  {Themes[id].name}
                </Text>
              ))}
            </Picker>

            <ThemePreview themeId={value.theme} displayName={theme.displayName} />
          </Section>

          <Section
            header={<SectionHeader>Windows &amp; Panes</SectionHeader>}
            footer={
              <Text modifiers={[font({ size: 13 }), foregroundColor(AppPalette.sectionHeader)]}>
                A phone is too narrow to read two Panes side by side, so a split Session arrives
                with one Pane filling the Window. The Panes sheet turns it off per Session.
              </Text>
            }
            modifiers={[listRowBackground(AppPalette.rowSurface)]}>
            <Toggle
              label="Zoom multipane windows"
              isOn={value.zoomMultipaneWindows}
              onIsOnChange={(on) => update({ zoomMultipaneWindows: on })}
              modifiers={[tint(AppPalette.controlAccent)]}
            />
          </Section>
        </Form>
      </Host>
    </View>
  );
}

/**
 * What the chosen Theme looks like: the same five lines remux shows, in the
 * Theme's own colours, down to the editor status line along the bottom.
 */
function ThemePreview({ themeId, displayName }: { themeId: ThemeId; displayName: string }) {
  const palette = Themes[themeId].palette;

  /** One line of the sample, as coloured runs. */
  const lines: { number: string; runs: { text: string; color: string }[] }[] = [
    {
      number: '1',
      runs: [
        { text: '#include ', color: palette.blue },
        { text: '<iostream>', color: palette.green },
      ],
    },
    { number: '2', runs: [] },
    {
      number: '3',
      runs: [
        { text: 'int', color: palette.yellow },
        { text: ' main() {', color: palette.foreground },
      ],
    },
    {
      number: '4',
      runs: [
        { text: '  std::cout << ', color: palette.foreground },
        { text: '"muxify"', color: palette.green },
        { text: ';', color: palette.foreground },
      ],
    },
    { number: '5', runs: [{ text: '}', color: palette.foreground }] },
  ];

  return (
    <VStack spacing={8} alignment="leading">
      <HStack>
        <Text modifiers={[font({ size: 17, weight: 'semibold' })]}>Preview</Text>
        <Spacer />
        <Text modifiers={[font({ size: 15 }), foregroundColor(AppPalette.sectionHeader)]}>
          {displayName}
        </Text>
      </HStack>

      <VStack
        spacing={0}
        alignment="leading"
        modifiers={[
          frame({ maxWidth: 3000 }),
          background(palette.background),
          cornerRadius(8),
          clipShape('roundedRectangle', 8),
        ]}>
        <VStack spacing={0} alignment="leading" modifiers={[padding({ all: 10 })]}>
          {lines.map((line) => (
            <HStack key={line.number} spacing={0}>
              <Text
                modifiers={[
                  font({ size: 11, design: 'monospaced' }),
                  monospacedDigit(),
                  foregroundColor(palette.grey),
                ]}>
                {`${line.number} `}
              </Text>
              {line.runs.map((run, at) => (
                <Text
                  key={at}
                  modifiers={[
                    font({ size: 11, design: 'monospaced' }),
                    foregroundColor(run.color),
                  ]}>
                  {run.text}
                </Text>
              ))}
              <Spacer />
            </HStack>
          ))}
        </VStack>

        {/* The editor's mode line: the sample is a file open in vim, and this
            is the half of the picture that shows what the Theme does to a
            filled background rather than to text on the ground colour. */}
        <HStack spacing={0} modifiers={[frame({ maxWidth: 3000 })]}>
          <Text
            modifiers={[
              font({ size: 11, design: 'monospaced' }),
              padding({ horizontal: 6, vertical: 2 }),
              foregroundColor(palette.background),
              background(palette.blue),
            ]}>
            NORMAL
          </Text>
          <Text
            modifiers={[
              font({ size: 11, design: 'monospaced' }),
              padding({ horizontal: 6, vertical: 2 }),
              foregroundColor(palette.foreground),
              frame({ maxWidth: 3000, alignment: 'leading' }),
              background(palette.grey),
            ]}>
            test.cpp
          </Text>
        </HStack>
      </VStack>
    </VStack>
  );
}

/** A section's title, in a grey that is actually legible on this background. */
function SectionHeader({ children }: { children: string }) {
  return (
    <Text
      modifiers={[
        font({ size: 13, weight: 'semibold' }),
        foregroundColor(AppPalette.sectionHeader),
      ]}>
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
});
