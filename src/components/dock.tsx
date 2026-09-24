import { isGlassEffectAPIAvailable } from 'expo-glass-effect';
import { Button, GlassEffectContainer, HStack, Host, Namespace } from '@expo/ui/swift-ui';
import { buttonStyle, frame, glassEffect, glassEffectId } from '@expo/ui/swift-ui/modifiers';
import type { SFSymbol } from 'sf-symbols-typescript';
import { useEffect, useId, useState } from 'react';
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
 * Built from SwiftUI glass primitives rather than RN views so adjacent buttons
 * actually merge and morph: a `Namespace` plus a `GlassEffectContainer` is the
 * sanctioned pattern, with `glassEffectId` giving each button an identity the
 * container can blend between.
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
  const namespace = useId();

  return (
    <Host matchContents style={styles.host}>
      <Namespace id={namespace}>
        <GlassEffectContainer spacing={12}>
          <HStack spacing={4}>
            {actions.map((action) => (
              <Button
                key={action.id}
                label={action.label}
                systemImage={action.systemImage}
                onPress={action.disabled ? () => {} : action.onPress}
                modifiers={[
                  // 44pt is the smallest reliably tappable target on iOS.
                  frame({ width: 52, height: 44 }),
                  buttonStyle('glass'),
                  glassEffect({ glass: { variant: 'regular', interactive: true }, shape: 'capsule' }),
                  glassEffectId(action.id, namespace),
                ]}
              />
            ))}
          </HStack>
        </GlassEffectContainer>
      </Namespace>
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
