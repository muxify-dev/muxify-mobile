# Keep the Key Row stable on touch

Status: implemented, iPad touch check pending

The user reports that the Key Row moves and its icons grow when touched.
The Key Row must keep its position, size, and icon size during a press.

## Acceptance checks

- Touch, hold, and release each fixed key. The capsule and icons do not grow,
  bounce, or move sideways.
- Keep the glass appearance. Show a press or armed modifier through color
  or a fixed-size background.
- Keep pair-key flicks, horizontal scrolling, arrow repeat, and VoiceOver
  actions working. A separate symbol bubble may show the selected symbol.
  It must not resize the key or the capsule.
- Verify the result on an iPhone and an iPad with Liquid Glass enabled.
- Keep the expected vertical movement when the software keyboard opens
  or closes. This issue concerns touch feedback, not keyboard placement.

## Investigation

`src/components/key-row.tsx` enables `isInteractive` on the capsule's
`GlassView`. This is a candidate cause, not a confirmed diagnosis.
The fixed icons use a size of 18 and do not have an explicit press scale.

Reproduce the movement before changing the implementation. Compare the
capsule with native interactive glass disabled. Preserve input behavior.
The Expo SDK 57 reference documents the interactive glass property:
https://docs.expo.dev/versions/v57.0.0/sdk/glass-effect/#isinteractive

## Comments

Added during the navigation design review on 10 November 2026.
At filing, no application change or device verification had been made.

## Implementation check

Removed interactive glass from the capsule. Fixed keys now use color feedback
inside their existing frame. The iPhone 17 simulator captured Escape at rest
and during a four-second hold. Before the change its bright pixel bounds moved
from [61, 2422, 100, 2461] to [40, 2421, 80, 2462]. After the change both captures
have [61, 2422, 100, 2461]. Images are /tmp/muxify-touch-before-rest.png,
/tmp/muxify-touch-before-held.png, /tmp/muxify-touch-after-rest.png, and
/tmp/muxify-touch-after-held.png.

The full isolated Key Row suite passed on the fixed code. It covers pairs,
sideways scrolling, modifiers, arrow repeat, copy, paste, and clear. One first
run failed the scrolling check. A baseline run and the fixed-code rerun passed.

The final full Key Row suite passed after keyboard integration. One earlier
run again failed the sideways scrolling check. The final rerun passed every
check. The iPad simulator reports a connected hardware keyboard and hides the
row, so the iPad touch check remains pending.
