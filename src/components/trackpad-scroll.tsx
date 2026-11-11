import { requireNativeView } from 'expo';
import { useEffect, useLayoutEffect, useRef, useState, type ComponentType } from 'react';
import { AppState, type NativeSyntheticEvent, type ViewProps } from 'react-native';

import { createTrackpadGesture, type TrackpadEvent, type TrackpadTarget } from '@/lib/trackpad-gesture';
import type { PaneSwipe } from '@/hooks/use-pane-swipe';
import type { Attach } from '@/tmux/attach';

type NativeProps = ViewProps & {
  enabled: boolean;
  contextEpoch: number;
  onTrackpadScroll(event: NativeSyntheticEvent<TrackpadEvent>): void;
};

const NativeTrackpadScroll: ComponentType<NativeProps> = requireNativeView('TrackpadScroll');

export function TrackpadScroll({ enabled, context, targets, selectionPane, scrollSpeed, attach, swipe, children, ...view }: ViewProps & {
  enabled: boolean;
  context: string;
  targets: readonly TrackpadTarget[];
  selectionPane: string | null;
  scrollSpeed: number;
  attach: Attach | null;
  swipe: PaneSwipe;
}) {
  const [active, setActive] = useState(AppState.currentState === 'active');
  const [epoch, setEpoch] = useState(0);
  const current = useRef({ enabled, active, swipe });
  useLayoutEffect(() => { current.current = { enabled, active, swipe }; });
  const gesture = useRef<ReturnType<typeof createTrackpadGesture> | null>(null);
  const serial = useRef(0);
  useLayoutEffect(() => {
    const next = ++serial.current;
    const handler = createTrackpadGesture({
      epoch: next, targets, selectionPane, scrollSpeed,
      allowed: () => current.current.enabled && current.current.active && !current.current.swipe.isTransitioning(),
      actions: {
        drag: (translation, width) => swipe.drag(translation, width, true),
        swipe: swipe.swipe, cancel: swipe.cancel,
        scroll: (paneId, lines, grid) => attach?.view(paneId).scroll(lines, grid),
      },
    });
    gesture.current = handler;
    setEpoch(next);
    return () => { handler.cancel(); gesture.current = null; };
  }, [context, enabled, active, selectionPane, scrollSpeed, attach]);
  useEffect(() => {
    const listener = AppState.addEventListener('change', (state) => {
      current.current.active = state === 'active';
      if (state !== 'active') gesture.current?.cancel();
      setActive(state === 'active');
    });
    return () => listener.remove();
  }, []);

  return <NativeTrackpadScroll {...view} enabled={enabled && active} contextEpoch={epoch}
    onTrackpadScroll={({ nativeEvent }) => gesture.current?.receive(nativeEvent)}>
    {children}
  </NativeTrackpadScroll>;
}
