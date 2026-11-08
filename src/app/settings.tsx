import { Stack } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  Form,
  Host,
  HStack,
  List,
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
  deleteDisabled,
  disabled,
  environment,
  fixedSize,
  font,
  foregroundColor,
  frame,
  listRowBackground,
  monospacedDigit,
  moveDisabled,
  padding,
  pickerStyle,
  scrollContentBackground,
  tag,
  tint,
} from '@expo/ui/swift-ui/modifiers';

import { SectionHeader } from '@/components/section-header';
import { Themes, THEME_IDS, type Appearance, type ThemeId } from '@/constants/app-theme';
import { useSettings } from '@/settings/settings-context';
import {
  DEFAULT_EXPLICIT_FONT_SIZE,
  hostScreenListRows,
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
  moveHostScreenLists,
  switchHostScreenList,
  type HostScreenList,
} from '@/settings/settings';

const HOST_SCREEN_LIST_NAMES: Record<HostScreenList, string> = {
  sessions: 'Sessions',
  topics: 'Topics',
};

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
  const { settings: value, update, appearance, palette } = useSettings();
  const usesDefaultSize = value.fontSize === null;
  const shownSize = value.fontSize ?? DEFAULT_EXPLICIT_FONT_SIZE;
  const theme = Themes[value.theme];
  const lists = value.hostScreenLists;

  return (
    <View style={styles.fill}>
      <Stack.Screen options={{ title: 'Settings' }} />
      <Host style={styles.fill} matchContents={false}>
        <Form
          modifiers={[
            // Dark whatever the phone is set to: SwiftUI reads the system
            // appearance, not React Navigation's theme, so a phone in light
            // mode renders black labels on this dark ground.
            environment('colorScheme', appearance),
            // The Form paints its own grouped background, which is the system
            // grey; the app is darker than that everywhere else.
            scrollContentBackground('hidden'),
            background(palette.background),
            tint(palette.controlAccent),
            // Edit mode is what shows the drag handles of the Host Screen
            // lists. Rows outside a List.ForEach have nothing to drag, so they
            // look as they did before.
            environment('editMode', 'active'),
          ]}>
          <Section
            header={<SectionHeader palette={palette}>Font</SectionHeader>}
            modifiers={[listRowBackground(palette.rowSurface)]}>
            <Toggle
              label="Use default size"
              isOn={usesDefaultSize}
              onIsOnChange={(on) =>
                update({ fontSize: on ? null : DEFAULT_EXPLICIT_FONT_SIZE })
              }
              modifiers={[tint(palette.controlAccent)]}
            />

            <HStack modifiers={[frame({ maxWidth: 3000 }), disabled(usesDefaultSize)]}>
              <Text>Font size</Text>
              <Spacer />
              <Text
                modifiers={[
                  monospacedDigit(),
                  foregroundColor(
                    usesDefaultSize ? palette.secondaryLabel : palette.toolbarTint,
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
            header={<SectionHeader palette={palette}>Theme</SectionHeader>}
            modifiers={[listRowBackground(palette.rowSurface)]}>
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

            <ThemePreview themeId={value.theme} displayName={theme.displayName} palette={palette} />
          </Section>

          <Section
            header={<SectionHeader palette={palette}>Windows &amp; Panes</SectionHeader>}
            footer={
              <Text modifiers={[font({ size: 13 }), foregroundColor(palette.sectionHeader)]}>
                A phone is too narrow to read two Panes side by side, so a split Session arrives
                with one Pane filling the Window. The Panes sheet turns it off per Session.
              </Text>
            }
            modifiers={[listRowBackground(palette.rowSurface)]}>
            <Toggle
              label="Zoom multipane windows"
              isOn={value.zoomMultipaneWindows}
              onIsOnChange={(on) => update({ zoomMultipaneWindows: on })}
              modifiers={[tint(palette.controlAccent)]}
            />
          </Section>

          <Section
            header={<SectionHeader palette={palette}>Host Screen</SectionHeader>}
            footer={
              <Text modifiers={[font({ size: 13 }), foregroundColor(palette.sectionHeader)]}>
                Every Host Screen shows the lists that are on, in this order. Drag a list to move
                it. One list always stays on. Turn Recent Sessions first off to list Sessions in
                the Host&apos;s order, as the Mac does.
              </Text>
            }
            modifiers={[listRowBackground(palette.rowSurface)]}>
            <List.ForEach
              onMove={(sources, destination) =>
                update({ hostScreenLists: moveHostScreenLists(lists, sources, destination) })
              }>
              {hostScreenListRows(lists).map((list) => {
                const on = lists.includes(list);
                return (
                  <Toggle
                    key={list}
                    label={HOST_SCREEN_LIST_NAMES[list]}
                    isOn={on}
                    onIsOnChange={(next) =>
                      update({ hostScreenLists: switchHostScreenList(lists, list, next) })
                    }
                    modifiers={[
                      tint(palette.controlAccent),
                      disabled(on && lists.length === 1),
                      // A list that is off has no place on the Host Screen to
                      // move it to.
                      moveDisabled(!on),
                      deleteDisabled(),
                    ]}
                  />
                );
              })}
            </List.ForEach>
            <Toggle
              label="Recent Sessions first"
              isOn={value.recentSessionsFirst}
              onIsOnChange={(on) => update({ recentSessionsFirst: on })}
              modifiers={[tint(palette.controlAccent)]}
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
function ThemePreview({
  themeId,
  displayName,
  palette,
}: {
  themeId: ThemeId;
  displayName: string;
  palette: Appearance;
}) {
  const colours = Themes[themeId].palette;

  /** One line of the sample, as coloured runs. */
  const lines: { number: string; runs: { text: string; color: string }[] }[] = [
    {
      number: '1',
      runs: [
        { text: '#include ', color: colours.blue },
        { text: '<iostream>', color: colours.green },
      ],
    },
    { number: '2', runs: [] },
    {
      number: '3',
      runs: [
        { text: 'int', color: colours.yellow },
        { text: ' main() {', color: colours.foreground },
      ],
    },
    {
      number: '4',
      runs: [
        { text: '  std::cout << ', color: colours.foreground },
        { text: '"muxify"', color: colours.green },
        { text: ';', color: colours.foreground },
      ],
    },
    { number: '5', runs: [{ text: '}', color: colours.foreground }] },
  ];

  return (
    <VStack spacing={8} alignment="leading">
      <HStack>
        <Text modifiers={[font({ size: 17, weight: 'semibold' })]}>Preview</Text>
        <Spacer />
        <Text modifiers={[font({ size: 15 }), foregroundColor(palette.sectionHeader)]}>
          {displayName}
        </Text>
      </HStack>

      <VStack
        spacing={0}
        alignment="leading"
        modifiers={[
          frame({ maxWidth: 3000 }),
          background(colours.background),
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
                  foregroundColor(colours.grey),
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
              foregroundColor(colours.black),
              background(colours.blue),
            ]}>
            NORMAL
          </Text>
          <Text
            modifiers={[
              font({ size: 11, design: 'monospaced' }),
              padding({ horizontal: 6, vertical: 2 }),
              foregroundColor(colours.white),
              frame({ maxWidth: 3000, alignment: 'leading' }),
              background(colours.grey),
            ]}>
            test.cpp
          </Text>
        </HStack>
      </VStack>
    </VStack>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
});
