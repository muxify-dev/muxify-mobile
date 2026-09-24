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
  buttonStyle,
  clipShape,
  controlSize,
  cornerRadius,
  environment,
  fixedSize,
  font,
  foregroundColor,
  frame,
  buttonBorderShape,
  glassEffect,
  labelStyle,
  layoutPriority,
  offset,
  padding,
  presentationBackground,
  presentationDetents,
  presentationDragIndicator,
  strokeBorder,
  tint,
  toggleStyle,
} from '@expo/ui/swift-ui/modifiers';
import type { SFSymbol } from 'sf-symbols-typescript';
import { Dimensions, StyleSheet } from 'react-native';

import type { SheetPalette } from '@/constants/app-theme';
import { useSettings } from '@/settings/settings-context';
import type { Frame } from '@/tmux/pane-topology';
import { gridContentHeight } from './sheet-layout';

/** One thing that can be picked, with enough to draw a preview of it. */
export interface PreviewCard {
  /** Stable identity, handed back to `onSelect`. */
  id: string;
  /** The large label: a Session or Window name, or a Pane's directory. */
  title: string;
  /** The small one underneath: what is running, and how many Panes. */
  detail: string;
  /** Whether this is where the Surface is attached right now. */
  current: boolean;
  /** What the Pane behind this card is showing, already trimmed to fit. */
  preview: string[];
  /** Shown over a Window's preview, as tmux numbers them. */
  badge?: string;
  /** Where a Pane sits in the diagram, as fractions. Panes only. */
  frame?: Frame;
}

export interface SheetAction {
  id: string;
  label: string;
  systemImage?: SFSymbol;
}

export interface PickerSheetProps {
  title: string;
  isPresented: boolean;
  onDismiss: () => void;
  cards: PreviewCard[];
  /** Panes are a diagram of the Window; everything else is a grid or a list. */
  layout: 'grid' | 'panes' | 'list';
  loading: boolean;
  error?: string;
  emptyMessage: string;
  onSelect: (id: string) => void;
  /** The bar along the bottom: New Window, or the two Splits. */
  actions?: SheetAction[];
  onAction?: (id: string) => void;
  /** The Zoom switch, shown only for Panes, and only when there are two. */
  zoom?: { on: boolean; onChange: (on: boolean) => void };
}

const SHEET_PADDING = 16;
/** The sheet is as wide as the screen, so its content is too. */
const CONTENT_WIDTH = Dimensions.get('window').width - SHEET_PADDING * 2;

/** The gaps between the sheet's parts, top to bottom. */
const HEADER_TO_CONTENT = 12;
const CONTENT_TO_ACTIONS = 16;
const ACTION_BAR_HEIGHT = 44;

const GRID_GAP = 10;
const GRID_CARD_WIDTH = Math.floor((CONTENT_WIDTH - GRID_GAP) / 2);
/** Window tiles are slightly taller than they are wide, so the chip fits. */
const GRID_CARD_HEIGHT = Math.ceil(GRID_CARD_WIDTH * 1.1);
const LIST_CARD_HEIGHT = 150;

/** The Pane diagram: a 4:3 well with the tiles inset inside it. */
const BOARD_HEIGHT = Math.ceil(CONTENT_WIDTH * 0.75);
const BOARD_INSET = 6;
const TILE_GAP = 4;

/** Corner radii, shared by whatever draws the shape and whatever outlines it. */
const BOARD_RADIUS = 12;
const CARD_RADIUS = 12;

const HEADER_HEIGHT = 38;
/** Room below the action bar for the home indicator. */
const SAFE_BOTTOM = 24;

/**
 * Everything in the sheet that is not the content: the height its cards have to
 * fit around.
 */
const CHROME_HEIGHT =
  SHEET_PADDING * 2 +
  HEADER_HEIGHT +
  HEADER_TO_CONTENT +
  CONTENT_TO_ACTIONS +
  ACTION_BAR_HEIGHT +
  SAFE_BOTTOM;

/** What is left for cards when the sheet is as tall as it is allowed to get. */
const CONTENT_BUDGET = Math.max(0, Dimensions.get('window').height * 0.9 - CHROME_HEIGHT);

/**
 * How tall this sheet should be.
 *
 * Measured, never a fraction of the screen: a fraction is the wrong height
 * twice, too tall for three Windows and too short for nine, and either way the
 * actions end up marooned below a gap. The Pane diagram is a fixed shape; a
 * grid takes what its rows need, up to the budget. See gridContentHeight.
 */
function sheetHeight(layout: PickerSheetProps['layout'], count: number): number {
  if (layout === 'panes') return CHROME_HEIGHT + BOARD_HEIGHT;
  const content = gridContentHeight(
    {
      count,
      perRow: layout === 'grid' ? 2 : 1,
      cardHeight: layout === 'grid' ? GRID_CARD_HEIGHT : LIST_CARD_HEIGHT,
      gap: GRID_GAP,
    },
    CONTENT_BUDGET,
  );
  return CHROME_HEIGHT + content;
}

/**
 * The glass sheet behind every Dock picker.
 *
 * Two shapes, because two questions. Sessions and Windows are a *grid of
 * previews*: a Window called "bash" among three others called "bash" is not a
 * choice on a phone, and what it is showing is the only thing that tells them
 * apart. Panes are a *diagram*: they are all in front of you already, so the
 * question is which part of the screen you mean, and pointing at where it sits
 * beats reading an index.
 *
 * The diagram deliberately does not show Pane contents. Four tiles of
 * six-point terminal text is a picture of a wall; the directory and the command
 * are what distinguish one Pane from the next, and they fit.
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
  isPresented,
  onDismiss,
  cards,
  layout,
  loading,
  error,
  emptyMessage,
  onSelect,
  actions,
  onAction,
  zoom,
}: PickerSheetProps) {
  // The live setting, not the one the Session was opened with: the Theme
  // decides whether the app is light or dark, and CONTEXT.md is explicit that
  // the chrome follows it immediately even though the Surface waits for the
  // next Attach.
  const { appearance, sheetPalette: palette } = useSettings();

  return (
    <Host matchContents style={styles.host}>
      <BottomSheet
        isPresented={isPresented}
        onIsPresentedChange={(presented) => {
          if (!presented) onDismiss();
        }}>
        <Group
          modifiers={[
            presentationDetents(
              layout === 'panes'
                ? [{ height: sheetHeight(layout, cards.length) }]
                : // A grid that had to be cut can be dragged open; one that fits
                  // has nothing to drag to.
                  [{ height: sheetHeight(layout, cards.length) }, 'large'],
            ),
            presentationDragIndicator('hidden'),
            // The Theme's appearance, not the phone's: Latte is a light
            // terminal and a dark sheet over it reads as two apps stitched
            // together — which is the same reason the Host Screen follows it.
            environment('colorScheme', appearance),
            // A colour, not a material: a material follows the *system*
            // appearance, so a phone in light mode would show a white sheet
            // over a Mocha terminal no matter what colorScheme says.
            presentationBackground(palette.sheet),
          ]}>
          <VStack spacing={0} modifiers={[padding({ all: SHEET_PADDING })]}>
            <Header title={title} onDismiss={onDismiss} />

            <VStack spacing={0} modifiers={[padding({ top: HEADER_TO_CONTENT })]}>
              {loading ? (
                <Note palette={palette}>Reading…</Note>
              ) : error !== undefined ? (
                <Text modifiers={[foregroundColor('#ff6b6b')]}>{error}</Text>
              ) : cards.length === 0 ? (
                <Note palette={palette}>{emptyMessage}</Note>
              ) : null}

              {cards.length > 0 && layout === 'panes' ? (
                <PaneBoard cards={cards} palette={palette} onSelect={onSelect} />
              ) : null}

              {cards.length > 0 && layout !== 'panes' ? (
                <ScrollView>
                  <VStack spacing={GRID_GAP}>
                    {rowsOf(cards, layout === 'grid' ? 2 : 1).map((row, index) => (
                      <HStack key={row.map((card) => card.id).join('|') || index} spacing={GRID_GAP}>
                        {row.map((card) => (
                          <PreviewButton
                            key={card.id}
                            card={card}
                            palette={palette}
                            width={layout === 'grid' ? GRID_CARD_WIDTH : CONTENT_WIDTH}
                            height={layout === 'grid' ? GRID_CARD_HEIGHT : LIST_CARD_HEIGHT}
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
            </VStack>

            <Spacer />

            {actions?.length || zoom ? (
              <Footer
                actions={actions ?? []}
                palette={palette}
                onAction={onAction}
                zoom={zoom}
              />
            ) : null}
          </VStack>
        </Group>
      </BottomSheet>
    </Host>
  );
}

/**
 * A rounded outline that actually follows the corner.
 *
 * `border` is SwiftUI's `.border()`, which strokes a **rectangle** — so on a
 * rounded tile the clip cuts the stroke off at each corner and leaves the
 * outline looking chewed. `strokeBorder` takes the shape, and draws inside it
 * rather than astride the edge, so a 2pt selected outline is 2pt of tile rather
 * than 1pt of tile and 1pt of whatever is behind it.
 */
function outline(color: string, lineWidth: number, cornerRadius: number) {
  return strokeBorder({
    content: color,
    style: { lineWidth },
    shape: 'roundedRectangle',
    cornerRadius,
  });
}

/** A line of explanation where the content would be. */
function Note({ children, palette }: { children: string; palette: SheetPalette }) {
  return (
    <HStack>
      <Text modifiers={[font({ size: 13 }), foregroundColor(palette.secondary)]}>{children}</Text>
      <Spacer />
    </HStack>
  );
}

/**
 * Close on the left, title centred over it.
 *
 * `role="close"` rather than an xmark of our own. The glyph used to sit off
 * centre, and the reason is in the Button's own contract: `systemImage` is
 * "only used when `label` is provided", so `label=""` was still a label — an
 * empty title laid out beside the icon, pushing it off the middle of its own
 * button. The close role draws the system's circular xmark, centred, with no
 * title slot to be empty.
 *
 * The accessibility label is still set by hand: the role draws a glyph, and a
 * glyph is unreadable to anything but an eye and unpressable to the e2e suite.
 */
function Header({ title, onDismiss }: { title: string; onDismiss: () => void }) {
  return (
    <ZStack>
      <Text modifiers={[font({ size: 17, weight: 'semibold' })]}>{title}</Text>
      <HStack modifiers={[frame({ height: HEADER_HEIGHT })]}>
        <Button
          role="close"
          onPress={onDismiss}
          modifiers={[
            labelStyle('iconOnly'),
            buttonStyle('glass'),
            buttonBorderShape('circle'),
            frame({ width: 34, height: 34 }),
            accessibilityLabel(`Close ${title}`),
          ]}
        />
        <Spacer />
      </HStack>
    </ZStack>
  );
}

/**
 * The Panes of a Window, drawn where they are rather than listed.
 *
 * Absolute placement inside one well: tmux splits nest arbitrarily, and any
 * row-and-column approximation gets the interesting layouts wrong. The frames
 * arrive as fractions, so one multiplication by the well's size places them.
 * See paneTopologyFrames for why those fractions are not tmux's real ones.
 */
function PaneBoard({
  cards,
  palette,
  onSelect,
}: {
  cards: PreviewCard[];
  palette: SheetPalette;
  onSelect: (id: string) => void;
}) {
  const well = {
    width: CONTENT_WIDTH - BOARD_INSET * 2,
    height: BOARD_HEIGHT - BOARD_INSET * 2,
  };

  return (
    <ZStack
      alignment="topLeading"
      modifiers={[
        // `alignment` on the stack settles the children against each other;
        // the frame needs its own, or SwiftUI centres the whole stack inside
        // it and every offset below is measured from the wrong corner.
        frame({ width: CONTENT_WIDTH, height: BOARD_HEIGHT, alignment: 'topLeading' }),
        background(palette.well),
        clipShape('roundedRectangle', BOARD_RADIUS),
        outline(palette.stroke, 1, BOARD_RADIUS),
      ]}>
      {cards.map((card) => {
        const box = card.frame ?? { x: 0, y: 0, width: 1, height: 1 };
        // Half the gap on every side of every tile, so the space between two
        // of them is one whole gap and the space to the edge is half of one.
        const width = box.width * well.width - TILE_GAP;
        const height = box.height * well.height - TILE_GAP;
        return (
          <Button
            key={card.id}
            onPress={() => onSelect(card.id)}
            modifiers={[
              frame({ width, height }),
              offset({
                x: BOARD_INSET + box.x * well.width + TILE_GAP / 2,
                y: BOARD_INSET + box.y * well.height + TILE_GAP / 2,
              }),
              buttonStyle('plain'),
              // A Button given children draws no label of its own, so the name
              // has to be restated for anything reading the screen.
              accessibilityLabel(card.title),
            ]}>
            <PaneTile card={card} palette={palette} width={width} height={height} />
          </Button>
        );
      })}
    </ZStack>
  );
}

function PaneTile({
  card,
  palette,
  width,
  height,
}: {
  card: PreviewCard;
  palette: SheetPalette;
  width: number;
  height: number;
}) {
  // A small tile with a large radius is a lozenge, so the corner follows the
  // tile rather than being set once for all of them.
  const radius = Math.max(1, Math.min(6, Math.min(width, height) * 0.18));

  return (
    <VStack
      spacing={2}
      modifiers={[
        frame({ width, height }),
        background(card.current ? palette.tileSelected : palette.tile),
        clipShape('roundedRectangle', radius),
        outline(card.current ? palette.accent : palette.stroke, card.current ? 2 : 1, radius),
      ]}>
      <Text
        modifiers={[
          font({ size: 13, weight: 'semibold' }),
          foregroundColor(card.current ? palette.accent : palette.primary),
        ]}>
        {card.title}
      </Text>
      <Text modifiers={[font({ size: 11, weight: 'medium' }), foregroundColor(palette.secondary)]}>
        {card.detail}
      </Text>
    </VStack>
  );
}

/** A Session or Window: its preview, with a badge and a label chip over it. */
function PreviewButton({
  card,
  palette,
  width,
  height,
  onSelect,
}: {
  card: PreviewCard;
  palette: SheetPalette;
  width: number;
  height: number;
  onSelect: (id: string) => void;
}) {
  return (
    <Button
      key={card.id}
      onPress={() => onSelect(card.id)}
      modifiers={[buttonStyle('plain'), frame({ width, height }), accessibilityLabel(card.title)]}>
      <ZStack
        alignment="topLeading"
        modifiers={[
          frame({ width, height }),
          background(palette.tile),
          clipShape('roundedRectangle', CARD_RADIUS),
          outline(
            card.current ? palette.accent : palette.stroke,
            card.current ? 1.25 : 1,
            CARD_RADIUS,
          ),
        ]}>
        <PreviewText lines={card.preview} palette={palette} />

        {card.badge !== undefined ? (
          <Text
            modifiers={[
              font({ size: 12, weight: 'bold' }),
              frame({ width: 28, height: 28 }),
              foregroundColor(card.current ? '#ffffff' : palette.primary),
              background(card.current ? palette.accent : palette.well),
              cornerRadius(8),
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
                font({ size: 11 }),
                padding({ horizontal: 8, vertical: 5 }),
                background(palette.scrim),
                cornerRadius(7),
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

/** What the Window is showing, in the smallest readable monospace. */
function PreviewText({ lines, palette }: { lines: string[]; palette: SheetPalette }) {
  return (
    <VStack alignment="leading" spacing={0} modifiers={[padding({ all: 8 })]}>
      {lines.map((line, index) => (
        <HStack key={index} spacing={0}>
          <Text
            modifiers={[
              font({ size: 7, design: 'monospaced' }),
              foregroundColor(palette.secondary),
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

/**
 * The bar along the bottom: one piece of glass holding every command the sheet
 * offers, divided rather than separated — the same shape as the Dock, because
 * it is the same kind of thing.
 */
function Footer({
  actions,
  palette,
  onAction,
  zoom,
}: {
  actions: SheetAction[];
  palette: SheetPalette;
  onAction?: (id: string) => void;
  zoom?: { on: boolean; onChange: (on: boolean) => void };
}) {
  return (
    <HStack
      spacing={0}
      modifiers={[
        frame({ width: CONTENT_WIDTH, height: ACTION_BAR_HEIGHT }),
        // Glass before padding, so the capsule is the bar rather than the bar
        // plus the gap above it.
        glassEffect({ glass: { variant: 'regular', interactive: true }, shape: 'capsule' }),
        padding({ top: CONTENT_TO_ACTIONS }),
      ]}>
      {actions.map((action, index) => (
        <Fragment key={action.id}>
          {index > 0 ? <Divider modifiers={[frame({ height: 24 })]} /> : null}
          <Spacer />
          <Button
            label={action.label}
            systemImage={action.systemImage}
            onPress={() => onAction?.(action.id)}
            modifiers={[
              buttonStyle('plain'),
              font({ size: 14, weight: 'semibold' }),
              foregroundColor(palette.primary),
            ]}
          />
          <Spacer />
        </Fragment>
      ))}
      {zoom ? (
        <>
          {actions.length > 0 ? <Divider modifiers={[frame({ height: 24 })]} /> : null}
          <Toggle
            label="Zoom"
            isOn={zoom.on}
            onIsOnChange={zoom.onChange}
            modifiers={[
              toggleStyle('switch'),
              controlSize('small'),
              // Otherwise the switch takes an equal share of the bar and the
              // two Splits are squeezed into the corner.
              fixedSize({ horizontal: true, vertical: false }),
              layoutPriority(1),
              padding({ horizontal: 11 }),
              tint(palette.accent),
            ]}
          />
        </>
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
