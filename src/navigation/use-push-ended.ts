import { useNavigation, type NativeStackNavigationProp } from 'expo-router';
import { useEffect, useState } from 'react';

/** The longest a push animates. A screen that gets no transitionEnd, as the first screen of a launch, starts after it. */
const PUSH_MS = 600;

/**
 * Whether the push that showed this screen has ended. A screen mounts its
 * rows only then, so the push animation does not share its frames with them
 * (ADR 0041). It stays true for the screen's life: a Back to it shows rows
 * that are already mounted.
 */
export function usePushEnded(): boolean {
  const navigation = useNavigation<NativeStackNavigationProp<Record<string, object | undefined>>>();
  const [ended, setEnded] = useState(false);
  useEffect(() => {
    if (ended) return;
    const off = navigation.addListener('transitionEnd', (event) => {
      if (!event.data.closing) setEnded(true);
    });
    const late = setTimeout(() => setEnded(true), PUSH_MS);
    return () => {
      off();
      clearTimeout(late);
    };
  }, [navigation, ended]);
  return ended;
}
