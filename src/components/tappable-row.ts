import { contentShape, shapes } from '@expo/ui/swift-ui/modifiers';

/**
 * Makes a whole row tappable, not just the words in it.
 *
 * SwiftUI hit-tests the visible parts of a stack — the Text and the Image —
 * and not the Spacer between them. Without this the middle of a row does
 * nothing, and only the name or the chevron at the far end opens it, which
 * reads as a row that is broken rather than one that is picky.
 */
export const TAPPABLE_ROW = contentShape(shapes.rectangle());
