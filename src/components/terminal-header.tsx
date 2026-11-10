import { Stack } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
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
  onBack: () => void;
  onTitle: () => void;
  options: OptionsItem[];
}

/** The native Header leaves the content area below its top safe area. */
export function TerminalHeader({
  title,
  terminal,
  onBack,
  onTitle,
  options,
}: TerminalHeaderProps) {
  const { width: windowWidth } = useWindowDimensions();

  return (
    <>
      <Stack.Screen options={{
        headerShown: true,
        headerTransparent: false,
        headerBackVisible: false,
        headerStyle: { backgroundColor: terminal.background },
        headerTintColor: terminal.foreground,
      }} />
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Button icon="chevron.backward" accessibilityLabel="Back" onPress={onBack}>
          Back
        </Stack.Toolbar.Button>
      </Stack.Toolbar>
      <Stack.Title asChild>
        <Pressable
          onPress={onTitle}
          accessible={false}
          testID="header-title"
          disabled={title === null}
          style={[styles.title, { maxWidth: windowWidth / 2 }]}>
          {title === null ? null : <TitleLines title={title} terminal={terminal} />}
        </Pressable>
      </Stack.Title>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Menu icon="ellipsis" accessibilityLabel="Options">
          <Stack.Toolbar.Label>Options</Stack.Toolbar.Label>
          {renderOptions(options)}
        </Stack.Toolbar.Menu>
      </Stack.Toolbar>
    </>
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
        accessibilityHint="Opens the Title Sheet"
        testID={title.kind === 'topic' ? 'topic-title' : 'attached-session'}>
        {name}
      </Text>
      <View style={styles.detail}>
        {title.program === null ? null : (
          <Text
            numberOfLines={1}
            maxFontSizeMultiplier={1.2}
            style={[styles.program, title.kind === 'topic' && styles.topicProgram, { color: terminal.dim }]}
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
  const groups: { id: string; items: Exclude<OptionsItem, { kind: 'divider' }>[] }[] = [
    { id: 'first', items: [] },
  ];
  for (const item of items) {
    if (item.kind === 'divider') {
      groups.push({ id: item.id, items: [] });
    } else {
      groups[groups.length - 1].items.push(item);
    }
  }
  return groups.filter((group) => group.items.length > 0).map((group) => (
    <Stack.Toolbar.Menu key={group.id} inline>
      {group.items.map((item) => {
        switch (item.kind) {
          case 'action':
            return (
              <Stack.Toolbar.MenuAction
                key={item.id}
                icon={item.systemImage}
                onPress={item.run}
                disabled={item.disabled}
                destructive={item.destructive}>
                {item.label}
              </Stack.Toolbar.MenuAction>
            );
          case 'toggle':
            return (
              <Stack.Toolbar.MenuAction
                key={item.id}
                icon={item.systemImage}
                isOn={item.isOn}
                onPress={() => item.set(!item.isOn)}>
                {item.label}
              </Stack.Toolbar.MenuAction>
            );
          case 'menu':
            return (
              <Stack.Toolbar.Menu key={item.id} icon={item.systemImage}>
                <Stack.Toolbar.Label>{item.label}</Stack.Toolbar.Label>
                {renderOptions(item.items)}
              </Stack.Toolbar.Menu>
            );
        }
      })}
    </Stack.Toolbar.Menu>
  ));
}

const styles = StyleSheet.create({
  title: {
    flexShrink: 1,
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
  topicProgram: {
    flexShrink: 0,
    maxWidth: '50%',
  },
  session: {
    fontSize: 11,
    lineHeight: 14,
    flexShrink: 1,
  },
});
