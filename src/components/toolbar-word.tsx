import { Pressable, StyleSheet, Text } from 'react-native';

/**
 * A word in the navigation bar: Cancel, Save, Create.
 *
 * Plain React Native rather than a SwiftUI island, because iOS 26 draws its
 * glass capsule around the width the bar button's view reports, and an island
 * reports one UIKit does not believe — the word came out spilling over a disc
 * sized for something else.
 */
export function ToolbarWord({
  label,
  color,
  onPress,
  bold = true,
}: {
  label: string;
  color: string;
  onPress: () => void;
  bold?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={styles.tap}>
      <Text style={[styles.word, { color, fontWeight: bold ? '600' : '400' }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tap: {
    paddingHorizontal: 8,
  },
  word: {
    fontSize: 17,
  },
});
