import { Link } from 'expo-router';
import { StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';

export default function HostsScreen() {
  return (
    <ThemedView style={styles.container}>
      <ThemedText type="subtitle">No Hosts yet</ThemedText>
      <ThemedText type="small" themeColor="textSecondary" style={styles.blurb}>
        Add an SSH Host to start attaching to tmux Sessions from this phone.
      </ThemedText>

      {/* Temporary entry point until ticket 12 routes through a saved Host. */}
      <Link href="/terminal" style={styles.link}>
        <ThemedText type="linkPrimary">Open Surface smoke test</ThemedText>
      </Link>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
  },
  blurb: {
    textAlign: 'center',
  },
  link: {
    marginTop: Spacing.three,
  },
});
