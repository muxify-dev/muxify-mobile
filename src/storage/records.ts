import type { IdentityKind } from '@/domain/validate-host-draft';

/** A machine Muxify can reach. Carries no credential — see Identity. */
export interface Host {
  id: string;
  displayName: string;
  address: string;
  port: number;
  /** Absolute path to tmux, for Hosts where it is not on a non-interactive PATH. */
  tmuxExecutablePath?: string;
  /** The Identity used to authenticate. Several Hosts may share one. */
  identityId: string;
}

/**
 * Who Muxify authenticates as. Deliberately separate from Host so one
 * credential can serve several of them, and so the credential itself has one
 * place to live — the keychain, keyed by this record's id.
 */
export interface Identity {
  id: string;
  username: string;
  kind: IdentityKind;
}

/** A Host's key as last seen, for trust on first use (ticket 13). */
export interface Fingerprint {
  hostId: string;
  value: string;
  /** ISO 8601, so a record is readable without the app. */
  firstSeenAt: string;
}

/**
 * A Session this phone has opened, and when it last did.
 *
 * Not the Session itself — that lives on the Host and outlives every
 * Connection. This is Muxify's memory of one, and it is the only reason the
 * Host Screen can put Sessions in the order *you* last wanted them: tmux knows
 * when a Session was created and when it last saw activity, but not when this
 * phone last looked at it.
 *
 * Keyed by name rather than by any id, because a Session has no identity
 * beyond its name — kill it and make another with the same name and tmux
 * considers the matter closed, so Muxify does too.
 */
export interface RecentSession {
  hostId: string;
  name: string;
  /** ISO 8601, so a record is readable without the app. */
  lastOpenedAt: string;
}

/**
 * Where the user was when Muxify last closed: the Session of the last Attach
 * that reached its attached phase, and the Topic it was opened from, if any.
 * Reconnect on start opens it again. A Disconnect clears it, because a
 * Disconnect means "do not take me back".
 */
export interface LastPlace {
  hostId: string;
  session: string;
  topicId: string | null;
}

/** The Browser Tab a Place has on top. */
export interface PlaceTab {
  /** The Host Tab's URL: what "is the Tab still there" compares. */
  url: string;
  /** The URL the Web View showed last, which a followed link moves away from `url`. */
  page: string;
  scrollY: number;
}

/**
 * Whose Place it is: the Topic the Attach holds, else its Session, by name.
 * A renamed Session is a new owner, with no Place.
 */
export type PlaceOwner =
  | { kind: 'topic'; topicId: string }
  | { kind: 'session'; session: string };

/** The owner of an Attach that holds `topicId` (null for none) and is in `session`. */
export function placeOwner(topicId: string | null, session: string): PlaceOwner {
  return topicId === null ? { kind: 'session', session } : { kind: 'topic', topicId };
}

export function sameOwner(left: PlaceOwner, right: PlaceOwner): boolean {
  return left.kind === 'topic'
    ? right.kind === 'topic' && left.topicId === right.topicId
    : right.kind === 'session' && left.session === right.session;
}

/**
 * Where the user was in one Topic, or in one Session with no Topic, on this
 * phone: a Topic Place or a Session Place. One per owner of each Host.
 *
 * The phone's own: tmux's active Window is shared with the Mac and every
 * other Client, so it cannot say where *this* phone was. See ADR 0020.
 */
export interface Place {
  hostId: string;
  owner: PlaceOwner;
  /** Session name. The Attach targets Sessions by name. */
  session: string;
  /** tmux's id (`@12`) first; index and name find it again after Reopen gives new ids. */
  window: { id: string; index: number; name: string } | null;
  /** tmux's Pane id (`%31`). */
  pane: string | null;
  /** Set while the Web View is on top. */
  tab: PlaceTab | null;
  /** ISO 8601. */
  at: string;
}

/** Everything the app persists, as it sits on disk. */
export interface Records {
  hosts: Host[];
  identities: Identity[];
  fingerprints: Fingerprint[];
  recentSessions: RecentSession[];
  lastPlace: LastPlace | null;
  places: Place[];
}

export function emptyRecords(): Records {
  return { hosts: [], identities: [], fingerprints: [], recentSessions: [], lastPlace: null, places: [] };
}

/**
 * The Last Place a saved value names, or null for a missing or bad one. Only
 * this field is checked: a bad one sends a cold start to the Hosts list, which
 * is a safe place to be.
 */
export function parseLastPlace(raw: unknown): LastPlace | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { hostId, session, topicId } = raw as Record<string, unknown>;
  if (typeof hostId !== 'string' || hostId === '') return null;
  if (typeof session !== 'string' || session === '') return null;
  if (topicId !== null && typeof topicId !== 'string') return null;
  return { hostId, session, topicId };
}

/**
 * The Places a saved file names: `places`, and the `topicPlaces` that builds
 * before Session Places wrote, as Topic Places. A bad entry is dropped on its
 * own: its Topic or Session opens where the Host says, which is where it
 * opened before there were Places.
 */
export function parsePlaces(places: unknown, legacyTopicPlaces: unknown): Place[] {
  const current = Array.isArray(places) ? places.flatMap((entry) => parsePlace(entry) ?? []) : [];
  const legacy = Array.isArray(legacyTopicPlaces) ? legacyTopicPlaces.flatMap((entry) => {
    if (!isObject(entry) || !isName(entry.topicId)) return [];
    const { topicId, ...rest } = entry;
    return parsePlace({ ...rest, owner: { kind: 'topic', topicId } }) ?? [];
  }) : [];
  // A file holds one of the two. Were it both, `places` comes first, so it wins a lookup.
  return [...current, ...legacy];
}

function parsePlace(raw: unknown): Place | null {
  if (!isObject(raw)) return null;
  const { hostId, owner, session, window, pane, tab, at } = raw;
  if (!isName(hostId) || !isName(session) || typeof at !== 'string') return null;
  const whose = parseOwner(owner);
  if (!whose || (whose.kind === 'session' && whose.session !== session)) return null;
  if (pane !== null && !isName(pane)) return null;
  const placeWindow = window === null ? null : parseWindow(window);
  if (placeWindow === undefined) return null;
  const placeTab = tab === null ? null : parseTab(tab);
  if (placeTab === undefined) return null;
  return { hostId, owner: whose, session, window: placeWindow, pane, tab: placeTab, at };
}

function parseOwner(raw: unknown): PlaceOwner | null {
  if (!isObject(raw)) return null;
  if (raw.kind === 'topic' && isName(raw.topicId)) return { kind: 'topic', topicId: raw.topicId };
  if (raw.kind === 'session' && isName(raw.session)) return { kind: 'session', session: raw.session };
  return null;
}

function parseWindow(raw: unknown): Place['window'] | undefined {
  if (!isObject(raw)) return undefined;
  const { id, index, name } = raw;
  if (!isName(id) || !Number.isInteger(index) || typeof name !== 'string') return undefined;
  return { id, index: index as number, name };
}

function parseTab(raw: unknown): PlaceTab | undefined {
  if (!isObject(raw)) return undefined;
  const { url, page, scrollY } = raw;
  if (!isName(url) || !isName(page) || typeof scrollY !== 'number' || !Number.isFinite(scrollY)) return undefined;
  return { url, page, scrollY };
}

function isObject(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === 'object' && raw !== null;
}

function isName(raw: unknown): raw is string {
  return typeof raw === 'string' && raw !== '';
}
