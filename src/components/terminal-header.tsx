import { Button, Divider, Host, Image, Menu, Toggle } from '@expo/ui/swift-ui';
import { accessibilityLabel, disabled, environment, frame } from '@expo/ui/swift-ui/modifiers';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { SFSymbol } from 'sf-symbols-typescript';

import type { TerminalPalette } from '@/constants/app-theme';

/** What the header says the screen is showing. */
export type HeaderTitle =
  | { kind: 'session'; session: string; program: string | null }
  | { kind: 'topic'; topic: string; program: string | null; session: string };

/**
 * One entry of the ⋯ menu. A table of these is rendered by one map, so the
 * order of the menu is the order of the table and nothing else.
 */
export type OptionsItem =
  | {
      kind: 'action';
      id: string;
      label: string;
      systemImage: SFSymbol;
      run: () => void;
      disabled?: boolean;
      destructive?: boolean;
    }
  | { kind: 'toggle'; id: string; label: string; systemImage: SFSymbol; isOn: boolean; set: (on: boolean) => void }
  | { kind: 'menu'; id: string; label: string; systemImage: SFSymbol; items: OptionsItem[] }
  | { kind: 'divider'; id: string };

export interface TerminalHeaderProps {
  /** Null before anything is attached: the header then has no title to show. */
  title: HeaderTitle | null;
  /** The Theme's terminal colours: the header sits on the terminal background. */
  terminal: TerminalPalette;
  /** The Theme's appearance, which the menu follows rather than the phone's. */
  appearance: 'light' | 'dark';
  onBack: () => void;
  onTitle: () => void;
  options: OptionsItem[];
  /** A finger landing on ⋯, before the menu is up. */
  onOptionsTouched: () => void;
}

/** How tall the header is, under the status bar inset. */
export const HEADER_HEIGHT = 44;

/**
 * The Terminal Screen's header: ‹ back, the title, and ⋯.
 *
 * React Native for the row and the title, SwiftUI for the menu: a `Menu` is
 * the one thing here with no React Native equivalent, and a Pressable that
 * opens a sheet is the one thing SwiftUI could not be driven through from the
 * e2e suite (see GlassRow).
 *
 * The title's lines each carry their own accessibility, and the Pressable
 * around them none. A Pressable that is itself accessible folds its children
 * into one element on iOS, which would hide the Session name and the program
 * from anything that reads the screen by id.
 */
export function TerminalHeader({
  title,
  terminal,
  appearance,
  onBack,
  onTitle,
  options,
  onOptionsTouched,
}: TerminalHeaderProps) {
  return (
    <View style={styles.row}>
      <Pressable
        onPress={onBack}
        accessibilityRole="button"
        accessibilityLabel="Back"
        testID="back"
        hitSlop={8}
        style={styles.side}>
        <Text style={[styles.back, { color: terminal.foreground }]}>‹</Text>
      </Pressable>

      <Pressable
        onPress={onTitle}
        accessible={false}
        testID="header-title"
        disabled={title === null}
        style={styles.title}>
        {title === null ? null : <TitleLines title={title} terminal={terminal} />}
      </Pressable>

      <View style={styles.side} onTouchStart={onOptionsTouched}>
        <Host matchContents>
          <Menu
            label={<Image systemName="ellipsis.circle" size={22} color={terminal.foreground} />}
            modifiers={[
              frame({ width: HEADER_HEIGHT, height: HEADER_HEIGHT }),
              environment('colorScheme', appearance),
              accessibilityLabel('Options'),
            ]}>
            {renderOptions(options)}
          </Menu>
        </Host>
      </View>
    </View>
  );
}

function TitleLines({ title, terminal }: { title: HeaderTitle; terminal: TerminalPalette }) {
  const name = title.kind === 'topic' ? title.topic : title.session;
  return (
    <>
      <Text
        numberOfLines={1}
        maxFontSizeMultiplier={1.2}
        style={[styles.name, { color: terminal.foreground }]}
        accessibilityHint="Opens the Windows"
        testID={title.kind === 'topic' ? 'topic-title' : 'attached-session'}>
        {name}
      </Text>
      <View style={styles.detail}>
        {title.program === null ? null : (
          <Text
            numberOfLines={1}
            maxFontSizeMultiplier={1.2}
            style={[styles.program, { color: terminal.dim }]}
            testID="pane-command">
            {title.program}
          </Text>
        )}
        {title.kind === 'topic' ? (
          <>
            {title.program === null ? null : <Text maxFontSizeMultiplier={1.2} style={[styles.program, { color: terminal.dim }]}> · </Text>}
            <Text
              numberOfLines={1}
              maxFontSizeMultiplier={1.2}
              style={[styles.session, { color: terminal.dim }]}
              testID="attached-session">
              {title.session}
            </Text>
          </>
        ) : null}
      </View>
    </>
  );
}

function renderOptions(items: OptionsItem[]): ReactNode[] {
  return items.map((item) => {
    switch (item.kind) {
      case 'action':
        return (
          <Button
            key={item.id}
            label={item.label}
            systemImage={item.systemImage}
            role={item.destructive ? 'destructive' : undefined}
            onPress={item.run}
            modifiers={[accessibilityLabel(item.label), disabled(item.disabled ?? false)]}
          />
        );
      case 'toggle':
        return (
          <Toggle
            key={item.id}
            label={item.label}
            systemImage={item.systemImage}
            isOn={item.isOn}
            onIsOnChange={item.set}
            modifiers={[accessibilityLabel(item.label)]}
          />
        );
      case 'menu':
        return (
          <Menu key={item.id} label={item.label} systemImage={item.systemImage}>
            {renderOptions(item.items)}
          </Menu>
        );
      case 'divider':
        return <Divider key={item.id} />;
    }
  });
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    height: HEADER_HEIGHT,
    paddingHorizontal: 4,
  },
  side: {
    width: HEADER_HEIGHT,
    height: HEADER_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  back: {
    fontSize: 34,
    lineHeight: 38,
    fontWeight: '400',
  },
  title: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: {
    fontSize: 15,
    lineHeight: 18,
    fontWeight: '600',
  },
  detail: {
    flexDirection: 'row',
    alignItems: 'center',
    maxWidth: '100%',
  },
  program: {
    fontSize: 12,
    lineHeight: 14,
    flexShrink: 1,
    fontWeight: '500',
  },
  session: {
    fontSize: 11,
    lineHeight: 14,
    flexShrink: 1,
  },
});
