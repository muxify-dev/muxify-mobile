import { Stack } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

/**
 * The band under the navigation bar, painted by the screen, and the screen's
 * content below it.
 *
 * The stack has one navigation bar for all screens. When the bar has a colour,
 * UIKit blends it from one screen's colour to the next over the full width
 * during a Back Swipe. Here the bar has no colour, and this view paints the
 * band, so the colour moves with its screen. With no `color`, the stack's
 * background shows. The padding follows the bar's height, also when the bar
 * hides.
 */
export function HeaderBand({ color, children }: { color?: string; children: ReactNode }) {
  const headerHeight = useHeaderHeight();
  return (
    <View style={[styles.fill, { paddingTop: headerHeight, backgroundColor: color }]}>
      <Stack.Screen options={{ headerTransparent: true, headerStyle: { backgroundColor: 'transparent' } }} />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
