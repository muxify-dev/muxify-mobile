import { useEffect, useState } from 'react';
import { Keyboard, type KeyboardMetrics } from 'react-native';

import type { ScreenRect } from '@/lib/terminal-clearance';

function screenRect(metrics: KeyboardMetrics | undefined): ScreenRect | null {
  return metrics ? {
    x: metrics.screenX,
    y: metrics.screenY,
    width: metrics.width,
    height: metrics.height,
  } : null;
}

export function useKeyboardFrame(): ScreenRect | null {
  const [frame, setFrame] = useState(() => screenRect(Keyboard.metrics()));
  useEffect(() => {
    const changed = Keyboard.addListener('keyboardWillChangeFrame', (event) => {
      setFrame(screenRect(event.endCoordinates));
    });
    const hidden = Keyboard.addListener('keyboardWillHide', () => setFrame(null));
    setFrame(screenRect(Keyboard.metrics()));
    return () => {
      changed.remove();
      hidden.remove();
    };
  }, []);
  return frame;
}
