import { GlassView, isGlassEffectAPIAvailable } from 'expo-glass-effect';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, { SlideInRight, SlideOutRight } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { tabAddress, tabLabel } from '@/browser/tabs';
import { useKeyboardFrame } from '@/hooks/use-keyboard-frame';
import type { DestinationRow } from '@/domain/destinations';
import { directoryName } from '@/lib/paths';
import {
  autoScrollSpeed, backToFan, drawerBottom, GRIP_SLOP, inCancelZone, inLiftLane, liftGrip, LIFT_LANE, WIDE_DRAWER_SCREEN, type DrawerFrame, type ListWindow, type Point,
} from '@/navigation/grip';
import { deviceLog } from '@/diagnostics/device-log';
import { speakingAs } from '@/diagnostics/log';
import { useSettings } from '@/settings/settings-context';

import { markSymbol } from './topic-marks';

/** What the chooser hook gives the drawer: see useTitleSheet. */
export interface EdgeDrawerState {
  open: boolean;
  rows: DestinationRow[];
  error?: string;
  /** A pick is on its way. */
  busy: boolean;
  onPick: (row: DestinationRow) => void;
  onDismiss: () => void;
}

/** Where the drawer is on screen, measured when it lays out, for a held finger to be checked against. */
interface Measured {
  overlay: { x: number; y: number; width: number; height: number } | null;
  /**
   * The panel's top and height inside its column, which starts
   * `PANEL_MARGIN` below the overlay's top. Only up and down: the panel
   * slides in from the right, so a measure of its x would catch the slide.
   */
  panel: { top: number; height: number } | null;
  /** The list's top inside the panel, and how tall the list and its content are. */
  listTop: number;
  listHeight: number;
  contentHeight: number;
  scrollY: number;
  rows: Map<string, { top: number; bottom: number }>;
}

/**
 * The Grip's Destinations action and the Edge Drawer as one control, for a
 * screen to render `<EdgeGrip {...grip}>` and `<EdgeDrawer {...drawer}>` with.
 *
 * While the finger that lit Destinations is still down, the row under it
 * is lit and a lift there picks it. Each lift closes the drawer: on no row
 * it picks nothing. See navigation/grip.ts.
 *
 * VoiceOver has no held finger: its activate on the Grip opens the drawer
 * with no hold, and the drawer stays open for its rows to be activated.
 */
export function useEdgeSwitcher(state: EdgeDrawerState, open: () => void) {
  const measured = useRef<Measured>({ overlay: null, panel: null, listTop: 0, listHeight: 0, contentHeight: 0, scrollY: 0, rows: new Map() });
  const heldAt = useRef<Point | null>(null);
  /** Where the held finger is now, for the scroll loop to read each frame. */
  const finger = useRef<Point | null>(null);
  const list = useRef<ScrollView>(null);
  /** The scroll loop's next frame and the time of its last one, while a held finger is near the list's top or bottom. */
  const scrolling = useRef<{ frame: number; last: number } | null>(null);
  /** Where the finger lit Destinations, on screen, for the panel to end at: see drawerBottom. */
  const [anchorY, setAnchorY] = useState<number | null>(null);
  /** While the finger that opened the drawer is down: the row it lights, and whether it is in the Cancel Zone or the Lift Lane. */
  const [hold, setHold] = useState<{ lit: string | null; cancelling: boolean } | null>(null);
  const { width } = useWindowDimensions();
  const panelWidth = drawerWidth(width);

  const frame = useCallback((): DrawerFrame | null => {
    const { overlay, panel } = measured.current;
    if (!overlay || !panel) return null;
    const right = overlay.x + overlay.width;
    const top = overlay.y + PANEL_MARGIN + panel.top;
    return { left: right - PANEL_MARGIN - panelWidth, right, top, bottom: top + panel.height, lane: LIFT_LANE };
  }, [panelWidth]);
  /**
   * What the drawer reports as it lays out and scrolls. The list reads from
   * the bottom, by the Grip, so it keeps its distance from the end as it
   * lays out: it opens at the end, and Tabs that arrive above do not move
   * the rows under the finger.
   */
  const measure = useMemo(() => {
    const fromEnd = () => {
      const { contentHeight, listHeight, scrollY } = measured.current;
      return contentHeight > 0 && listHeight > 0 ? Math.max(contentHeight - listHeight - scrollY, 0) : 0;
    };
    const keepFromEnd = (gap: number) => {
      const { contentHeight, listHeight } = measured.current;
      if (contentHeight === 0 || listHeight === 0) return;
      const y = Math.max(contentHeight - listHeight - gap, 0);
      measured.current.scrollY = y;
      list.current?.scrollTo({ y, animated: false });
    };
    return {
      overlay: (frame: NonNullable<Measured['overlay']>) => { measured.current.overlay = frame; },
      panel: (top: number, height: number) => { measured.current.panel = { top, height }; },
      list: (top: number, height: number) => {
        const gap = fromEnd();
        measured.current.listTop = top;
        measured.current.listHeight = height;
        keepFromEnd(gap);
      },
      content: (height: number) => {
        const gap = fromEnd();
        measured.current.contentHeight = height;
        keepFromEnd(gap);
      },
    scroll: (y: number) => { measured.current.scrollY = y; },
      row: (key: string, top: number, bottom: number) => { measured.current.rows.set(key, { top, bottom }); },
    };
  }, []);
  /** Each open starts at the list's end and ends at `at`: its sizes come again as it mounts. */
  const opening = useCallback((at: Point) => {
    Object.assign(measured.current, { panel: null, listHeight: 0, contentHeight: 0, scrollY: 0 });
    setAnchorY(at.y);
    open();
  }, [open]);

  const { rows, onPick, onDismiss } = state;
  const rowAt = useCallback((point: Point): string | null => {
    const { listTop, scrollY } = measured.current;
    const panel = frame();
    if (!panel || point.x < panel.left || inLiftLane(point, panel)) return null;
    const y = point.y - panel.top - listTop + scrollY;
    // Only the rows listed now: a row of an earlier open keeps its old place in the map.
    const row = rows.find((each) => {
      const place = measured.current.rows.get(each.key);
      return place !== undefined && y >= place.top && y < place.bottom;
    });
    return row?.key ?? null;
  }, [frame, rows]);

  const pickKey = useCallback((key: string) => {
    const row = rows.find((each) => each.key === key);
    if (row && row.kind !== 'topic') onPick(row);
  }, [rows, onPick]);

  /** Lights the row under the held finger, or the Cancel Zone. */
  const light = useCallback((to: Point) => {
    const at = heldAt.current;
    const panel = frame();
    // Nothing is lit until the finger leaves the point where it lit Destinations, where a lift picks nothing.
    const away = at !== null && Math.hypot(to.x - at.x, to.y - at.y) > GRIP_SLOP;
    const lit = away ? rowAt(to) : null;
    const next = {
      lit,
      cancelling: away && panel !== null && inCancelZone(to, panel),
    };
    setHold((now) => (now?.lit === next.lit && now.cancelling === next.cancelling ? now : next));
  }, [frame, rowAt]);

  const stopScrolling = useCallback(() => {
    if (scrolling.current) cancelAnimationFrame(scrolling.current.frame);
    scrolling.current = null;
  }, []);
  /**
   * A held finger cannot scroll the list itself, so near the list's top or
   * bottom the list scrolls under it, one step each frame, and the row now
   * under the finger is lit. The loop stops when the finger leaves the edge
   * or lifts. The finger opens the drawer low in the list, so the scroll
   * waits until it has moved off the point where it opened.
   */
  const startScrolling = useCallback(() => {
    if (scrolling.current) return;
    const step = (now: number) => {
      const to = finger.current;
      const at = heldAt.current;
      const panel = frame();
      const { listTop, listHeight, contentHeight, scrollY } = measured.current;
      const window: ListWindow | null = panel ? { top: panel.top + listTop, bottom: panel.top + listTop + listHeight } : null;
      const away = to !== null && at !== null && Math.hypot(to.x - at.x, to.y - at.y) > GRIP_SLOP;
      const speed = away && panel && window ? autoScrollSpeed(to, panel, window) : 0;
      if (!to || speed === 0 || !scrolling.current) {
        stopScrolling();
        return;
      }
      const seconds = Math.min((now - scrolling.current.last) / 1000, 0.05);
      const end = Math.max(contentHeight - listHeight, 0);
      const y = Math.min(Math.max(scrollY + speed * seconds, 0), end);
      if (y !== scrollY) {
        measured.current.scrollY = y;
        list.current?.scrollTo({ y, animated: false });
        light(to);
      }
      scrolling.current = { frame: requestAnimationFrame(step), last: now };
    };
    scrolling.current = { frame: requestAnimationFrame(step), last: performance.now() };
  }, [frame, light, stopScrolling]);
  useEffect(() => stopScrolling, [stopScrolling]);

  /**
   * Where the finger opened the drawer and where each row is on screen, in
   * the Log. The rows show only once a finger holds the Grip, so a driver
   * that must slide onto one cannot ask the screen first: it holds once,
   * reads this, and slides from the same place.
   */
  const latestRows = useRef(rows);
  useEffect(() => { latestRows.current = rows; }, [rows]);
  const sayWhereRowsAre = useCallback((at: Point) => {
    const panel = frame();
    if (!panel) return;
    say(`the Edge Drawer opened at ${Math.round(at.x)},${Math.round(at.y)}`);
    const { listTop, scrollY } = measured.current;
    const x = Math.round((panel.left + panel.right - panel.lane) / 2);
    for (const row of latestRows.current) {
      const place = measured.current.rows.get(row.key);
      const label = drawnLabel(row);
      if (!place || label === null) continue;
      const y = Math.round(panel.top + listTop + (place.top + place.bottom) / 2 - scrollY);
      say(`the Edge Drawer shows ${label} at ${x},${y}`);
    }
  }, [frame]);

  /** The held finger is no longer the drawer's. */
  const letGo = () => {
    heldAt.current = null;
    finger.current = null;
    stopScrolling();
    setHold(null);
  };

  const grip = {
    onDestinations: (at: Point) => {
      heldAt.current = at;
      finger.current = at;
      setHold({ lit: null, cancelling: false });
      opening(at);
      setTimeout(() => { if (heldAt.current === at) sayWhereRowsAre(at); }, LAID_OUT_MS);
    },
    /** 'fan' when the finger went down past the panel: the drawer closes, and the Grip opens its Fan again. */
    onHeldMove: (to: Point): 'drawer' | 'fan' => {
      const at = heldAt.current;
      const panel = frame();
      if (at && panel && backToFan(to, at, panel)) {
        letGo();
        say('the finger went back from the Edge Drawer to the Fan');
        onDismiss();
        return 'fan';
      }
      finger.current = to;
      light(to);
      startScrolling();
      return 'drawer';
    },
    onHeldLift: (to: Point) => {
      letGo();
      const panel = frame();
      const lift = panel ? liftGrip(to, panel, rowAt) : null;
      const row = lift?.kind === 'pick' ? rows.find((each) => each.key === lift.key) : undefined;
      // A Topic's title is not a Destination: a lift there picks nothing.
      if (row && row.kind !== 'topic') onPick(row);
      else onDismiss();
    },
    onOpen: opening,
  };

  const drawer = {
    ...state,
    width: panelWidth,
    anchorY,
    wide: width >= WIDE_DRAWER_SCREEN,
    held: hold !== null,
    lit: hold?.lit ?? null,
    cancelling: hold?.cancelling ?? false,
    onPickKey: pickKey,
    measure,
    list,
  };
  return { grip, drawer };
}

/**
 * The Edge Drawer: a panel at the right edge that lists every Destination,
 * from the Grip's Destinations action. It ends at the finger that lit it and is
 * as tall as its list, up to the top of the screen, so the last row is by the finger. On a phone it covers most of the screen over a scrim, and a
 * tap on the scrim closes it. On an iPad it is a column with no scrim, and
 * the terminal beside it stays live.
 *
 * Its rows go in the order of `destinationRows` from the bottom up, with
 * the Title Sheet's marks, so the place on screen is by the Grip. While the finger that opened it is held, the area outside the
 * panel is the Cancel Zone and says so. The Lift Lane at the panel's right,
 * beside the rows, is where that finger can rest; a lift there closes the
 * drawer with no pick. It is not drawn.
 */
export function EdgeDrawer({
  open, rows, error, busy, onDismiss, width, anchorY, wide, held, lit, cancelling, onPickKey, measure, list,
}: ReturnType<typeof useEdgeSwitcher>['drawer']) {
  const { palette: chrome, sheetPalette: palette, appearance } = useSettings();
  const insets = useSafeAreaInsets();
  const overlay = useRef<View>(null);
  const layout = useMemo(() => drawerLayout(rows), [rows]);
  const keyboard = useKeyboardFrame();
  const screenHeight = useWindowDimensions().height;
  /**
   * The panel is as tall as its title and rows, up to its column. These are
   * set from the layout and from the list's content as Tabs arrive: a
   * ScrollView left to size itself by its rows does not grow when rows come
   * after it lays out, so the last row was cut off.
   */
  const [columnHeight, setColumnHeight] = useState<number | null>(null);
  const [titleHeight, setTitleHeight] = useState(0);
  const [rowsHeight, setRowsHeight] = useState(0);
  if (!open) return null;
  const panelHeight = columnHeight === null || rowsHeight === 0
    ? columnHeight ?? undefined
    : Math.min(columnHeight, titleHeight + rowsHeight + 2 * StyleSheet.hairlineWidth);
  const keyboardCovers = keyboard !== null && keyboard.height > 0 ? Math.max(screenHeight - keyboard.y, 0) : 0;
  const floorY = screenHeight - (keyboardCovers > 0 ? keyboardCovers : insets.bottom) - PANEL_MARGIN;
  // The overlay ends at the screen's bottom, so a y on screen is this far up from its bottom.
  const bottom = screenHeight - (anchorY === null ? floorY : drawerBottom(anchorY, floorY));

  const scrim = !wide || held;
  return (
    <View
      ref={overlay}
      style={StyleSheet.absoluteFill}
      pointerEvents={wide && !held ? 'box-none' : 'auto'}
      onLayout={() => overlay.current?.measureInWindow((x, y, w, h) => measure.overlay({ x, y, width: w, height: h }))}>
      {scrim ? (
        <Pressable
          style={[StyleSheet.absoluteFill, { backgroundColor: wide ? 'transparent' : SCRIM }]}
          onPress={onDismiss}
          accessibilityLabel="Close Destinations"
          accessibilityRole="button">
          {held ? (
            <View style={[styles.cancel, { right: width, bottom }]} pointerEvents="none">
              <SymbolView name="xmark.circle.fill" size={22} tintColor={cancelling ? '#ffffff' : 'rgba(255,255,255,0.7)'} />
              <Text style={[styles.cancelText, { opacity: cancelling ? 1 : 0.7 }]}>Lift here to close</Text>
            </View>
          ) : null}
        </Pressable>
      ) : null}
      {/*
        * The slide is on a full-screen layer whose size never changes: an
        * Animated.View with an entering animation keeps the size it mounted
        * with, and the panel's height changes as Tabs arrive.
        */}
      <Animated.View
        entering={SlideInRight.duration(180)}
        exiting={SlideOutRight.duration(150)}
        style={StyleSheet.absoluteFill}
        pointerEvents="box-none">
        {/* The column the panel can fill; the panel sits at its bottom and is as tall as its list. */}
        <View
          style={[styles.column, { width, bottom }]}
          pointerEvents="box-none"
          onLayout={({ nativeEvent: { layout: box } }) => setColumnHeight(box.height)}>
          <View
            style={[styles.panel, { borderColor: palette.stroke, height: panelHeight }]}
            onLayout={({ nativeEvent: { layout: box } }) => measure.panel(box.y, box.height)}
            accessibilityViewIsModal={!wide}
            onAccessibilityEscape={onDismiss}>
            {isGlassEffectAPIAvailable() ? (
              <GlassView pointerEvents="none" style={StyleSheet.absoluteFill} glassEffectStyle="regular" colorScheme={appearance} />
            ) : (
              <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: palette.sheet }]} />
            )}
            <View style={styles.top} onLayout={({ nativeEvent: { layout: box } }) => setTitleHeight(box.height)}>
              <View style={styles.header}>
                <View style={styles.headerText}>
                  <Text style={[styles.kicker, { color: palette.secondary }]}>{layout.kicker}</Text>
                  <Text style={[styles.title, { color: palette.primary }]} numberOfLines={1}>{layout.title}</Text>
                </View>
                {busy ? <Text style={[styles.detail, { color: palette.secondary }]}>Going…</Text> : null}
              </View>
              {error ? <Text style={[styles.error, { color: chrome.destructive }]}>{error}</Text> : null}
            </View>
            {/* Its right margin is the Lift Lane: bare glass, so the rows stop short of the finger. */}
            <ScrollView
              ref={list}
              style={styles.list}
              onLayout={({ nativeEvent: { layout: box } }) => measure.list(box.y, box.height)}
              scrollEnabled={!held}
              onContentSizeChange={(_, height) => {
                setRowsHeight(height);
                measure.content(height);
              }}
              onScroll={({ nativeEvent }) => measure.scroll(nativeEvent.contentOffset.y)}
              scrollEventThrottle={16}
              contentContainerStyle={styles.listContent}>
              {layout.items.map((item) => (
                <View
                  key={item.key}
                  onLayout={({ nativeEvent: { layout: box } }) => measure.row(item.key, box.y, box.y + box.height)}>
                  {item.kind === 'header' ? (
                    <SectionHeader item={item} lit={lit === item.key} onPress={() => onPickKey(item.key)} />
                  ) : (
                    <DestinationRowView item={item} lit={lit === item.key} onPress={() => onPickKey(item.key)} />
                  )}
                </View>
              ))}
            </ScrollView>
          </View>
        </View>
      </Animated.View>
    </View>
  );
}

/** One item of the list as it is drawn: a Session's header, or a row of its card. */
type DrawerItem =
  | { kind: 'header'; key: string; name: string; current: boolean }
  | { kind: 'row'; key: string; row: Exclude<DestinationRow, { kind: 'topic' | 'session' }>; first: boolean; last: boolean };

/**
 * The list as iOS groups one: a header and a card for each Session, with
 * the attached Session's card last, by the Grip. Its title is the Topic's
 * label, or the attached Session's name when the Attach holds no Topic. A
 * header is the Session's row: a lift on it goes to that Session.
 */
function drawerLayout(rows: DestinationRow[]): { kicker: string; title: string; items: DrawerItem[] } {
  const topic = rows.find((row) => row.kind === 'topic');
  const sections: { key: string; name: string; current: boolean; rows: Extract<DrawerItem, { kind: 'row' }>['row'][] }[] = [];
  for (const row of rows) {
    if (row.kind === 'topic') continue;
    if (row.kind === 'session') {
      sections.push({ key: row.key, name: row.name, current: row.current, rows: [] });
      continue;
    }
    // With no Topic the rows start at a Window, which names its Session.
    if (sections.length === 0) {
      const name = row.kind === 'pane' ? '' : row.session;
      sections.push({ key: `header:${name}`, name, current: true, rows: [] });
    }
    sections[sections.length - 1].rows.push(row);
  }
  const ordered = [...sections.filter((each) => !each.current).reverse(), ...sections.filter((each) => each.current)];
  const items = ordered.flatMap((section): DrawerItem[] => {
    // With no Topic the one Session is the title: a header would say it again.
    const header: DrawerItem[] = topic ? [{ kind: 'header', key: section.key, name: section.name, current: section.current }] : [];
    return [...header, ...section.rows.map((row, index) => ({
      kind: 'row' as const, key: row.key, row, first: index === 0, last: index === section.rows.length - 1,
    }))];
  });
  return topic
    ? { kicker: 'TOPIC', title: topic.label, items }
    : { kicker: 'SESSION', title: sections[0]?.name ?? '', items };
}

function SectionHeader({ item, lit, onPress }: { item: Extract<DrawerItem, { kind: 'header' }>; lit: boolean; onPress: () => void }) {
  const { sheetPalette: palette } = useSettings();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Session ${item.name}`}
      accessibilityState={{ selected: item.current }}
      style={[styles.sectionHeader, lit && { backgroundColor: palette.tileSelected }]}>
      <SymbolView name="terminal" size={12} tintColor={palette.secondary} />
      <Text numberOfLines={1} style={[styles.sectionTitle, { color: palette.secondary }]}>{item.name.toUpperCase()}</Text>
      {item.current ? <Text style={[styles.sectionTitle, { color: palette.accent }]}>CURRENT</Text> : null}
    </Pressable>
  );
}

function DestinationRowView({ item, lit, onPress }: { item: Extract<DrawerItem, { kind: 'row' }>; lit: boolean; onPress: () => void }) {
  const { palette: chrome, sheetPalette: palette } = useSettings();
  const { row } = item;
  const parts = rowParts(row);
  const mark = (row.kind === 'window' && row.window.mark) || null;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={parts.label}
      accessibilityState={{ selected: row.here }}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: lit || pressed ? palette.tileSelected : row.here ? palette.tileHere : palette.tile,
          paddingLeft: 12 + parts.indent * 18,
        },
        item.first && styles.firstRow,
        item.last && styles.lastRow,
      ]}>
      <SymbolView name={parts.icon} size={parts.indent ? 14 : 17} tintColor={parts.indent ? palette.secondary : palette.accent} style={styles.icon} />
      <View style={styles.rowText}>
        <Text numberOfLines={1} style={[styles.name, row.here && styles.nameHere, { color: palette.primary }]}>{parts.name}</Text>
        {parts.detail ? <Text numberOfLines={1} style={[styles.detail, { color: palette.secondary }]}>{parts.detail}</Text> : null}
      </View>
      {mark ? <MarkSymbol {...markSymbol(mark, chrome)} /> : null}
      {item.last ? null : <View style={[styles.separator, { left: 46 + parts.indent * 18, backgroundColor: palette.stroke }]} />}
    </Pressable>
  );
}

function MarkSymbol({ symbol, color }: { symbol: SFSymbol; color: string }) {
  return <SymbolView name={symbol} size={15} tintColor={color} />;
}

/** The accessibility label a row is drawn with, or null for a row the drawer does not draw. */
function drawnLabel(row: DestinationRow): string | null {
  if (row.kind === 'topic') return null;
  if (row.kind === 'session') return `Session ${row.name}`;
  return rowParts(row).label;
}

/** What a row says: its name, a second line, its symbol and its indent under its Window. */
function rowParts(row: Extract<DrawerItem, { kind: 'row' }>['row']): {
  name: string; detail?: string; icon: SFSymbol; indent: number; label: string;
} {
  switch (row.kind) {
    case 'window':
      return {
        name: `${row.window.index}  ${row.window.name}`, detail: row.window.program ?? undefined, icon: 'macwindow', indent: 0,
        label: `Window ${row.window.index} ${row.window.name}`,
      };
    case 'pane':
      return {
        name: `Pane ${row.pane.index} · ${row.pane.command}`, detail: directoryName(row.pane.path) || undefined,
        icon: 'rectangle.split.2x1', indent: 1, label: `Pane ${row.pane.index} ${row.pane.command}`,
      };
    case 'tab':
      return { name: tabLabel(row.tab), detail: tabAddress(row.tab), icon: 'globe', indent: 1, label: `Tab ${tabLabel(row.tab)}` };
  }
}

/** On a phone most of the screen, which leaves a strip for the Cancel zone; on an iPad a column. */
function drawerWidth(screen: number): number {
  return screen >= WIDE_DRAWER_SCREEN ? 320 : Math.min(Math.round(screen * 0.85), 420);
}

/** How far the floating panel sits in from the screen's edges. */
const PANEL_MARGIN = 8;
/** How long after a hold the drawer has laid out, and says where its rows are. */
const LAID_OUT_MS = 300;

const say = speakingAs(deviceLog(), 'screen');
const SCRIM = 'rgba(0, 0, 0, 0.35)';

const styles = StyleSheet.create({
  column: { position: 'absolute', top: PANEL_MARGIN, right: PANEL_MARGIN, justifyContent: 'flex-end' },
  panel: {
    borderRadius: 26,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 18, paddingTop: 16, paddingBottom: 8 },
  headerText: { flex: 1 },
  kicker: { fontSize: 11, fontWeight: '600', letterSpacing: 0.6 },
  title: { fontSize: 20, fontWeight: '700' },
  error: { fontSize: 13, paddingHorizontal: 18, paddingBottom: 8 },
  top: { flexShrink: 0 },
  list: { flex: 1, marginRight: LIFT_LANE - PANEL_MARGIN },
  listContent: { paddingLeft: 10, paddingBottom: 10 },
  sectionHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingTop: 16, paddingBottom: 6, borderRadius: 10,
  },
  sectionTitle: { fontSize: 12, fontWeight: '600', letterSpacing: 0.4 },
  row: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10, paddingRight: 12, paddingVertical: 6 },
  firstRow: { borderTopLeftRadius: 14, borderTopRightRadius: 14 },
  lastRow: { borderBottomLeftRadius: 14, borderBottomRightRadius: 14 },
  separator: { position: 'absolute', right: 0, bottom: 0, height: StyleSheet.hairlineWidth },
  icon: { width: 22, height: 22 },
  rowText: { flex: 1 },
  name: { fontSize: 16 },
  nameHere: { fontWeight: '600' },
  detail: { fontSize: 12 },
  cancel: { position: 'absolute', left: 0, top: 0, alignItems: 'center', justifyContent: 'flex-end', gap: 6, paddingHorizontal: 4, paddingBottom: 12 },
  cancelText: { color: '#ffffff', fontSize: 11, fontWeight: '600', textAlign: 'center' },
});
