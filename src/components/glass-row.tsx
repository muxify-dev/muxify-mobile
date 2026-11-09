import { GlassView, isGlassEffectAPIAvailable } from 'expo-glass-effect';
import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';

/**
 * A tappable Liquid Glass card.
 *
 * The press is React Native's rather than SwiftUI's, deliberately. `@expo/ui`
 * Buttons work in the Key Row but do not respond to a synthesised tap anywhere in
 * these screens, and a list whose rows cannot be proven to work is worse than
 * one that looks slightly less native. The glass itself is still the real API.
 */
export function GlassRow({
  onPress,
  accessibilityLabel,
  style,
  children,
}: {
  onPress?: () => void;
  accessibilityLabel: string;
  style?: ViewStyle;
  children: React.ReactNode;
}) {
  const content = isGlassEffectAPIAvailable() ? (
    <GlassView style={[styles.card, style]} glassEffectStyle="regular" isInteractive={!!onPress}>
      {children}
    </GlassView>
  ) : (
    <View style={[styles.card, styles.plain, style]}>{children}</View>
  );

  if (!onPress) return content;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => (pressed ? styles.pressed : undefined)}>
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 18,
    overflow: 'hidden',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  plain: {
    backgroundColor: '#1e2230',
  },
  pressed: {
    opacity: 0.7,
  },
});
