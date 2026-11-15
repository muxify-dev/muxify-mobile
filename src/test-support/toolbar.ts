import type { ReactNode } from 'react';
import type { ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';

function Toolbar({ children }: { children?: ReactNode }) {
  return children;
}
function ToolbarButton() {
  return null;
}
Toolbar.Button = ToolbarButton;

/** expo-router's `Stack` for a screen test: the toolbar keeps its buttons in the tree, so a test can press them by their words. */
export const mockStack = { Stack: { Screen: () => null, Toolbar } };

/** The top bar button with these words, or with this accessibility label. */
export function toolbarButton(renderer: ReactTestRenderer, label: string): ReactTestInstance {
  return renderer.root.find((node) => node.type === ToolbarButton
    && (node.props.children === label || node.props.accessibilityLabel === label));
}

/** The one top bar button on this side, whatever its words. */
export function toolbarSide(renderer: ReactTestRenderer, placement: 'left' | 'right'): ReactTestInstance {
  return renderer.root.find((node) => node.type === Toolbar && node.props.placement === placement).findByType(ToolbarButton);
}
