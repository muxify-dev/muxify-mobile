/**
 * Whether a Host's `#{version}` is this tmux release or a later one.
 *
 * tmux prints `3.5a` for a release, `next-3.9` for a build of the next one
 * and `master` for an old build from git. An OpenBSD base system prints its
 * own release, `openbsd-6.8`, which says nothing of the tmux features, so it
 * reads as older, like any other string.
 */
export function tmuxAtLeast(version: string, major: number, minor: number): boolean {
  if (version === 'master') return true;
  const match = /^(?:next-)?(\d+)\.(\d+)/.exec(version);
  if (match === null) return false;
  const [hasMajor, hasMinor] = [Number(match[1]), Number(match[2])];
  return hasMajor > major || (hasMajor === major && hasMinor >= minor);
}
