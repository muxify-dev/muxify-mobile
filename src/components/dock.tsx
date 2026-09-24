import { isGlassEffectAPIAvailable } from 'expo-glass-effect';
import { Button, HStack, Host } from '@expo/ui/swift-ui';
import {
  buttonStyle,
  disabled,
  frame,
  glassEffect,
  labelStyle,
  padding,
} from '@expo/ui/swift-ui/modifiers';
import type { SFSymbol } from 'sf-symbols-typescript';
import { useEffect, useState } from 'react';
import { Keyboard, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { SurfacePalette } from '@/constants/theme';

export interface DockAction {
  /** Stable id, also used as the glass effect identity within the namespace. */
  id: string;
  label: string;
  systemImage: SFSymbol;
  onPress: () => void;
  disabled?: boolean;
}

export interface DockProps {
  /** Each group renders as its own merged glass capsule. */
  groups: DockAction[][];
}

/**
 * The Liquid Glass bar pinned to the bottom of the Terminal Screen.
 *
 * Built from SwiftUI glass primitives rather than RN views, with the glass
 * applied once around the whole row: giving each button its own capsule makes
 * the Dock read as a chain of separate blobs, and it is one control.
 *
 * Note this bar carries no modifier keys. The terminal library ships its own
 * Accessory Bar with ctrl, esc and tab above the keyboard and exposes no way to
 * hide it, so duplicating them here would stack two rows of the same keys —
 * see ADR 0003.
 */
/**
 * Height the Dock must clear to stay tappable.
 *
 * The terminal library's Accessory Bar is an input accessory view, so it sits
 * at the bottom of the screen on top of everything else whenever the Surface is
 * focused — directly over the Dock. Without this the Dock is covered exactly
 * when the terminal is in use, and taps land on ctrl/alt/cmd instead. iOS
 * reports the accessory bar's height as part of the keyboard frame, so one
 * listener covers both.
 */
function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const show = Keyboard.addListener('keyboardWillChangeFrame', (event) => {
      setInset(event.endCoordinates?.height ?? 0);
    });
    const hide = Keyboard.addListener('keyboardWillHide', () => setInset(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return inset;
}

export function Dock({ groups }: DockProps) {
  // Some iOS 26 betas ship without the underlying effect class and crash on
  // use, so probe the runtime API rather than the design-mode flag — they are
  // different checks and only this one guards the crash.
  const glassAvailable = isGlassEffectAPIAvailable();
  const keyboardInset = useKeyboardInset();

  return (
    <View
      style={[styles.dock, keyboardInset > 0 && { marginBottom: keyboardInset }]}
      pointerEvents="box-none">
      {groups.map((group, index) =>
        glassAvailable ? (
          <GlassGroup key={group[0]?.id ?? index} actions={group} />
        ) : (
          <PlainGroup key={group[0]?.id ?? index} actions={group} />
        ),
      )}
    </View>
  );
}

function GlassGroup({ actions }: { actions: DockAction[] }) {
  return (
    <Host matchContents style={styles.host}>
      <HStack
        spacing={0}
        modifiers={[
          // One piece of glass around the whole row, rather than one per
          // button. Per-button capsules merge into a chain of blobs; the Dock
          // is a single control and should read as one.
          padding({ horizontal: 6, vertical: 4 }),
          glassEffect({ glass: { variant: 'regular', interactive: true }, shape: 'capsule' }),
        ]}>
        {actions.map((action) => (
          <Button
            key={action.id}
            label={action.label}
            systemImage={action.systemImage}
            onPress={action.onPress}
            modifiers={[
              // 44pt is the smallest reliably tappable target on iOS.
              frame({ width: 52, height: 44 }),
              buttonStyle('plain'),
              // Icon only, but the label stays: it is what the accessibility
              // tree exposes, and what every e2e suite presses by.
              labelStyle('iconOnly'),
              // Actually disabled, not merely inert: a button that looks
              // pressable and does nothing is worse than one that says so.
              disabled(action.disabled ?? false),
            ]}
          />
        ))}
      </HStack>
    </Host>
  );
}

/**
 * Fallback for a device whose runtime lacks the glass API. Every target device
 * for this project is iOS 26.4+, so this exists only to keep such a device
 * usable rather than transparent — a GlassView on an unsupported runtime mounts
 * and renders nothing at all.
 */
function PlainGroup({ actions }: { actions: DockAction[] }) {
  return (
    <View style={styles.plainGroup}>
      {actions.map((action) => (
        <Pressable
          key={action.id}
          onPress={action.onPress}
          disabled={action.disabled}
          accessibilityRole="button"
          accessibilityLabel={action.label}
          style={styles.plainButton}>
          <ThemedText type="small" style={styles.plainLabel}>
            {action.label}
          </ThemedText>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  dock: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingBottom: 8,
  },
  host: {
    alignSelf: 'center',
  },
  plainGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 22,
    backgroundColor: '#242838',
  },
  plainButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  plainLabel: {
    color: SurfacePalette.foreground,
  },
});
