import { CONTROL_ACTIONS, type QuickAction } from '@/lib/quick-actions';

type PaneShortcut = Extract<QuickAction, 'split-right' | 'split-down' | 'clear-pane' | 'copy-pane'>;

export function runQuickAction(action: QuickAction, target: {
  control: (key: string) => void;
  paste: () => void;
  goTo: () => void;
  shortcut: (id: PaneShortcut) => void;
}) {
  switch (action) {
    case 'paste':
      target.paste();
      return;
    case 'go-to':
      target.goTo();
      return;
    case 'split-right':
    case 'split-down':
    case 'copy-pane':
    case 'clear-pane':
      target.shortcut(action);
      return;
    default:
      CONTROL_ACTIONS[action].keys.forEach(target.control);
  }
}
