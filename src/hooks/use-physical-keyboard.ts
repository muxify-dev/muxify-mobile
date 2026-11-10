import { requireOptionalNativeModule } from 'expo';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

interface PhysicalKeyboardModule {
  isConnected(): boolean;
  addListener(event: 'onChange', listener: (event: { connected: boolean }) => void): { remove(): void };
}

const physicalKeyboard = Platform.OS === 'ios'
  ? requireOptionalNativeModule<PhysicalKeyboardModule>('PhysicalKeyboard')
  : null;

if (Platform.OS === 'ios' && !physicalKeyboard) {
  throw new Error('PhysicalKeyboard is unavailable. Rebuild the iOS app to include the native module.');
}

export function usePhysicalKeyboard(): boolean {
  const [connected, setConnected] = useState(() => physicalKeyboard?.isConnected() ?? false);

  useEffect(() => {
    if (!physicalKeyboard) return;
    const subscription = physicalKeyboard.addListener('onChange', (event) => setConnected(event.connected));
    setConnected(physicalKeyboard.isConnected());
    return () => subscription.remove();
  }, []);

  return connected;
}
