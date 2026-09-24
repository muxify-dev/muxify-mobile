import { Fragment } from 'react';

import {
  BottomSheet,
  Button,
  Divider,
  Group,
  Host,
  HStack,
  ScrollView,
  Spacer,
  Text,
  Toggle,
  VStack,
  ZStack,
} from '@expo/ui/swift-ui';
import {
  accessibilityLabel,
  background,
  border,
  buttonStyle,
  clipShape,
  cornerRadius,
  environment,
  font,
  foregroundColor,
  frame,
  offset,
  padding,
  presentationBackground,
  presentationDetents,
  presentationDragIndicator,
  tint,
} from '@expo/ui/swift-ui/modifiers';
import type { SFSymbol } from 'sf-symbols-typescript';
import { Dimensions, StyleSheet } from 'react-native';

import { SurfacePalette } from '@/constants/theme';
import type { Frame } from '@/tmux/preview';

/** One thing that can be picked, with enough to draw a preview of it. */
export interface PreviewCard {
  /** Stable identity, handed back to `onSelect`. */
  id: string;
  /** The large label: a Session or Window name, or a Pane's title. */
  title: string;
  /** The small one underneath: what is running, and how many Panes. */
  detail: string;
  /** Whether this is where the Surface is attached right now. */
  current: boolean;
  /** What the Pane behind this card is showing, already trimmed to fit. */
  preview: string[];
  /** Shown over a Window's preview, as tmux numbers them. */
  badge?: string;
  /** Where a Pane sits in its Window, as fractions. Panes only. */
  frame?: Frame;
}

export interface SheetAction {
  id: string;
  label: string;
  systemImage?: SFSymbol;
}

export interface PickerSheetProps {
  title: string;
  /** The line under the title: which Session, and how many of what. */
  subtitle: string;
  isPresented: boolean;
  onDismiss: () => void;
  cards: PreviewCard[];
  /** Panes are laid out as the Window is; everything else is a list. */
  layout: 'grid' | 'panes' | 'list';
  loading: boolean;
  error?: string;
  emptyMessage: string;
  /** What to say when there is one: nothing to pick, but plenty to do. */
  onlyOneMessage?: string;
  onSelect: (id: string) => void;
  /** The bar along the bottom: New Window, or the two Splits. */
  actions?: SheetAction[];
  onAction?: (id: string) => void;
  /** The Zoom switch, shown only for Panes. */
  zoom?: { on: boolean; onChange: (on: boolean) => void };
}

const SHEET_BACKGROUND = '#15171d';
const SHEET_PADDING = 18;
/** The sheet is as wide as the screen, so its content is too. */
const CONTENT_WIDTH = Dimensions.get('window').width - SHEET_PADDING * 2;
const GRID_GAP = 12;
const GRID_CARD_WIDTH = (CONTENT_WIDTH - GRID_GAP) / 2;
const PANE_BOARD_HEIGHT = 230;
const CARD_HEIGHT = 150;

/**
 * The glass sheet behind every Dock picker.
 *
 * Each row is a preview of the thing it picks rather than its name: on a phone
 * a Window called "bash" among three others called "bash" is not a choice, and
 * what the Pane is actually showing is the only thing that distinguishes them.
 * Panes are laid out the way the Window is really split, so picking one is
 * pointing at where it is rather than reading an index.
 *
 * Rows are Buttons rather than List selection: a tap is a one-shot command to
 * the Host, not state the sheet owns. It is also the only form that carries a
 * pressable label through the SwiftUI hosting boundary into the accessibility
 * tree, which is what makes the picker testable at all.
 *
 * The Host is zero-sized and absolutely positioned, because the sheet presents
 * itself over everything and its anchor must not take part in layout — a
 * laid-out anchor would eat a row of the Surface.
 */
export function PickerSheet({
  title,
  subtitle,
  isPresented,
  onDismiss,
  cards,
  layout,
  loading,
  error,
  emptyMessage,
  onlyOneMessage,
  onSelect,
  actions,
  onAction,
  zoom,
}: PickerSheetProps) {
  return (
    <Host matchContents style={styles.host}>
      <BottomSheet
        isPresented={isPresented}
        onIsPresentedChange={(presented) => {
          if (!presented) onDismiss();
        }}>
        <Group
          modifiers={[
            presentationDetents([{ fraction: 0.66 }, 'large']),
            presentationDragIndicator('hidden'),
            // The Surface is always dark, so the sheet is too — otherwise a
            // phone in light mode flashes a white panel over the terminal.
            environment('colorScheme', 'dark'),
            // A colour, not a material: a material follows the system
            // appearance, so a phone in light mode shows a white sheet over a
            // dark terminal no matter what colorScheme says.
            presentationBackground(SHEET_BACKGROUND),
          ]}>
          <VStack spacing={14} modifiers={[padding({ all: SHEET_PADDING })]}>
            <Header title={title} onDismiss={onDismiss} />

            <HStack>
              <Text
                modifiers={[font({ size: 15 }), foregroundColor(SurfacePalette.dim)]}>
                {subtitle}
              </Text>
              <Spacer />
            </HStack>

            {loading ? <Text modifiers={[foregroundColor(SurfacePalette.dim)]}>Reading…</Text> : null}
            {error !== undefined ? (
              <Text modifiers={[foregroundColor('#ff6b6b')]}>{error}</Text>
            ) : null}
            {!loading && error === undefined && cards.length === 0 ? (
              <Text modifiers={[foregroundColor(SurfacePalette.dim)]}>{emptyMessage}</Text>
            ) : null}

            {!loading && cards.length === 1 && onlyOneMessage ? (
              <Text modifiers={[font({ size: 13 }), foregroundColor(SurfacePalette.dim)]}>
                {onlyOneMessage}
              </Text>
            ) : null}

            {cards.length > 0 && layout === 'panes' ? (
              <PaneBoard cards={cards} onSelect={onSelect} />
            ) : null}
            {cards.length > 0 && layout !== 'panes' ? (
              <ScrollView>
                <VStack spacing={12}>
                  {rowsOf(cards, layout === 'grid' ? 2 : 1).map((row, index) => (
                    <HStack key={row.map((card) => card.id).join('|') || index} spacing={12}>
                      {row.map((card) => (
                        <PreviewButton
                          key={card.id}
                          card={card}
                          width={layout === 'grid' ? GRID_CARD_WIDTH : CONTENT_WIDTH}
                          onSelect={onSelect}
                        />
                      ))}
                      {/* A lone card on the last row keeps its column rather
                          than stretching across both. */}
                      {row.length === 1 && layout === 'grid' ? <Spacer /> : null}
                    </HStack>
                  ))}
                </VStack>
              </ScrollView>
            ) : null}

            <Spacer />

            {actions?.length || zoom ? (
              <Footer actions={actions ?? []} onAction={onAction} zoom={zoom} />
            ) : null}
          </VStack>
        </Group>
      </BottomSheet>
    </Host>
  );
}

/** Close on the left, title centred over it. */
function Header({ title, onDismiss }: { title: string; onDismiss: () => void }) {
  return (
    <ZStack>
      <Text modifiers={[font({ size: 19, weight: 'semibold' })]}>{title}</Text>
      <HStack>
        <Button
          label=""
          systemImage="xmark"
          onPress={onDismiss}
          modifiers={[frame({ width: 38, height: 38 }), buttonStyle('glass')]}
        />
        <Spacer />
      </HStack>
    </ZStack>
  );
}

/**
 * The Panes of a Window, drawn where they actually are.
 *
 * Absolute placement rather than a stack: tmux splits nest arbitrarily, and any
 * row-and-column approximation gets the interesting layouts wrong. The frames
 * are fractions, so one multiplication by the board's size places them.
 */
function PaneBoard({
  cards,
  onSelect,
}: {
  cards: PreviewCard[];
  onSelect: (id: string) => void;
}) {
  const width = CONTENT_WIDTH;
  const height = PANE_BOARD_HEIGHT;

  return (
    <ZStack alignment="topLeading" modifiers={[frame({ width, height })]}>
      {cards.map((card) => {
        const box = card.frame ?? { x: 0, y: 0, width: 1, height: 1 };
        return (
          <Button
            key={card.id}
            onPress={() => onSelect(card.id)}
            modifiers={[
              frame({ width: box.width * width, height: box.height * height }),
              offset({ x: box.x * width, y: box.y * height }),
              buttonStyle('plain'),
              // A Button given children draws no label of its own, so the name
              // has to be restated for anything reading the screen.
              accessibilityLabel(card.title),
            ]}>
            <PaneTile card={card} />
          </Button>
        );
      })}
    </ZStack>
  );
}

function PaneTile({ card }: { card: PreviewCard }) {
  return (
    <ZStack
      alignment="center"
      modifiers={[
        // Fill whatever the Button was given, so the label centres in the Pane
        // rather than settling wherever the preview happens to end.
        frame({ maxWidth: 3000, maxHeight: 3000 }),
        background(card.current ? '#2f4f86' : '#2a2d37'),
        cornerRadius(10),
        border({ color: card.current ? '#5b8def' : '#3a3e4a', width: card.current ? 2 : 1 }),
        clipShape('roundedRectangle'),
      ]}>
      <PreviewText lines={card.preview} size={6} />
      <VStack spacing={2}>
        <Text modifiers={[font({ size: 13, weight: 'semibold' })]}>{card.title}</Text>
        <Text modifiers={[font({ size: 11 }), foregroundColor(SurfacePalette.dim)]}>
          {card.detail}
        </Text>
      </VStack>
    </ZStack>
  );
}

/** A Session or Window: its preview, with a badge and a label chip over it. */
function PreviewButton({
  card,
  width,
  onSelect,
}: {
  card: PreviewCard;
  width: number;
  onSelect: (id: string) => void;
}) {
  return (
    <Button
      key={card.id}
      onPress={() => onSelect(card.id)}
      modifiers={[
        buttonStyle('plain'),
        frame({ width, height: CARD_HEIGHT }),
        accessibilityLabel(card.title),
      ]}>
      <ZStack
        alignment="topLeading"
        modifiers={[
          frame({ width, height: CARD_HEIGHT }),
          background('#23262e'),
          cornerRadius(12),
          border({ color: card.current ? '#5b8def' : '#33363f', width: card.current ? 2 : 1 }),
          clipShape('roundedRectangle'),
        ]}>
        <PreviewText lines={card.preview} size={7} />

        {card.badge !== undefined ? (
          <Text
            modifiers={[
              font({ size: 13, weight: 'bold' }),
              padding({ horizontal: 9, vertical: 4 }),
              background(card.current ? '#3b6ce0' : '#3a3e4a'),
              cornerRadius(9),
              offset({ x: 8, y: 8 }),
            ]}>
            {card.badge}
          </Text>
        ) : null}

        <VStack>
          <Spacer />
          <HStack>
            <Text
              modifiers={[
                font({ size: 12, weight: 'medium' }),
                padding({ horizontal: 9, vertical: 5 }),
                background('#14161c'),
                cornerRadius(9),
                offset({ x: 8, y: -8 }),
              ]}>
              {card.detail}
            </Text>
            <Spacer />
          </HStack>
        </VStack>
      </ZStack>
    </Button>
  );
}

/** What the Pane is showing, in the smallest readable monospace. */
function PreviewText({ lines, size }: { lines: string[]; size: number }) {
  return (
    <VStack alignment="leading" spacing={0} modifiers={[padding({ all: 6 })]}>
      {lines.map((line, index) => (
        <HStack key={index} spacing={0}>
          <Text
            modifiers={[
              font({ size, design: 'monospaced' }),
              foregroundColor(SurfacePalette.dim),
            ]}>
            {line === '' ? ' ' : line}
          </Text>
          <Spacer />
        </HStack>
      ))}
      <Spacer />
    </VStack>
  );
}

/** The pill along the bottom: actions, and the Zoom switch for Panes. */
function Footer({
  actions,
  onAction,
  zoom,
}: {
  actions: SheetAction[];
  onAction?: (id: string) => void;
  zoom?: { on: boolean; onChange: (on: boolean) => void };
}) {
  return (
    <HStack
      spacing={10}
      modifiers={[
        padding({ horizontal: 14, vertical: 8 }),
        background('#22252d'),
        cornerRadius(22),
      ]}>
      {actions.map((action, index) => (
        <Fragment key={action.id}>
          {index > 0 ? <Divider modifiers={[frame({ height: 22 })]} /> : null}
          <Spacer />
          <Button
            label={action.label}
            systemImage={action.systemImage}
            onPress={() => onAction?.(action.id)}
            modifiers={[buttonStyle('plain'), font({ size: 16 })]}
          />
          <Spacer />
        </Fragment>
      ))}
      {zoom ? (
        <Toggle
          label="Zoom"
          isOn={zoom.on}
          onIsOnChange={zoom.onChange}
          modifiers={[tint('#3b6ce0')]}
        />
      ) : null}
    </HStack>
  );
}

function rowsOf(cards: PreviewCard[], perRow: number): PreviewCard[][] {
  const rows: PreviewCard[][] = [];
  for (let index = 0; index < cards.length; index += perRow) {
    rows.push(cards.slice(index, index + perRow));
  }
  return rows;
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    width: 0,
    height: 0,
  },
});
