# Keep the native Header title between its controls

Status: resolved

A long Topic title extends behind Options in the native Header. UIKit gives
its center view 258 points, but the React title remains 320.33 points wide.
The two title lines and their separate accessibility ids must remain.

## Comments

The simulator check found the overlap in both Themes. The evidence is in
`/tmp/muxify-impl-handoff.Sc0532/phase9-solarized-large-title.json` and the
matching screenshot. The title ends at x392.33. Options starts at x346.

The installed `RNSScreenStackHeaderSubviewShadowNode.cpp` copies UIKit's
center origin into the shadow layout, but does not copy its allocated width.
`RNSScreenStackHeaderSubviewComponentDescriptor.h` explicitly avoids setting
that size. A percentage width on the React title therefore uses the wrong
container width. Native-stack exposes no title-container style or width
callback.

A supported layout fix still needs the simulator check before this issue can
be resolved. Do not use a fixed Header height or a guessed button gutter.

## Candidate

The title requests the full window width from the native center view. After
layout, its measured window origin gives the space UIKit left between the
controls. The inner Pressable uses window width minus twice that origin.
The outer View does not handle touches. It remains wide when the title is
short, so a later long title can still use the full allocated space.

This uses one local width state and the supported View measurement API.
There is no fixed gutter, polling, or native patch. The lead must check cold
entry, title changes, large text, and native button taps before resolution.

## Rotation evidence and replacement

The origin measurement passed portrait checks but failed after rotation. The
landscape title began at x0 and used all 874 points. A native origin is not a
reliable measure of the space between controls. The failed evidence is in
`/tmp/muxify-impl-handoff.Sc0532/phase9-theme-cold.log`.

The Header Yoga tree contains custom left and right items. Native Toolbar
Button and Menu items instead become separate UIBarButtonItems, so Yoga does
not subtract their widths. HeaderConfig padding accounts for native margins
and the system Back button, but not those native items.

The replacement uses two custom Toolbar Views with SwiftUI glass controls.
Their 44-point Hosts are the actual controls, so both widths enter the same
Yoga row as the title. The title uses normal shrinking. The failed width
measurement and its state are removed. Opening Options still starts no read.

The change follows the allocation approach described in upstream
[react-native-screens PR 2905](https://github.com/software-mansion/react-native-screens/pull/2905).
That change removed fixed child sizes because they prevented later content
changes from updating native layout. This replacement keeps that behavior
and adds no native patch. Runtime verification remains open.

## Compact title policy

The custom Toolbar Views also failed. UIKit allocated 242 points to the
center view, but the inner title remained 270 points wide and reached x356.
Options started at x336. The evidence is in
`/tmp/muxify-impl-handoff.Sc0532/phase9-theme-custom.log`.

The current candidate restores the native Toolbar Button and Menu. It limits
the title to half the current window width and preserves its natural width
below that limit. This is a compact title policy for one icon control per
side and windows at least 320 points wide. It does not measure UIKit's title
allocation. The Title Sheet shows the full title. Both Header lines and their
accessibility ids remain. Opening Options still starts no read.

The width limit updates with the window dimensions. A future additional
control or text button requires a new policy. Runtime checks must cover cold
maximum text, rotation, long-to-short-to-long title changes, and the narrowest
supported phone and iPad windows. The issue remains open until those checks
pass. No native dependency patch is needed for this candidate.

## Answer

The compact title policy passed cold entry at maximum text size in both
Themes, portrait and landscape, and a native 320-point window. Live Topic
changes from long to short to long keep both title lines between Back and
Options. The full title remains available in the Title Sheet. Options and
Split Pane accept taps. No native patch or layout measurement state remains.

Evidence is in `/tmp/muxify-impl-handoff.Sc0532/phase9-theme-compact.log` and
`phase9-narrow-passed.log` in the same folder. The root inspected the narrow
screenshot and the Theme screenshots. The rename fault found by this check
is resolved in issue 03.
