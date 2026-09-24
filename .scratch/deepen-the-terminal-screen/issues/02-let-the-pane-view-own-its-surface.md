# 02 — Let the Pane view own its Surface

**What to build:** a Pane on screen is painted by its view, not by the screen.
Every Pane of a split paints with what is already on it the moment it appears,
whether its Surface or its grid arrived first, and never at the eleven-row grid
the Surface reports before layout. One cursor shows, in the Pane the keyboard
is in, and stays hidden elsewhere through redraws. The keyboard toggle acts on
the Surface that actually has focus.

**Blocked by:** None (can start immediately). Touches the same screen as 01;
land it after 01 to avoid a merge, but nothing in it waits on 01.

**Status:** done

`[~]` marks a criterion that needs a device or the simulator; it was not run
here, and the code was checked against it by reading.

The view is handed a Surface adapter (write bytes, focus, blur, whether focused)
when the Surface exists and told each grid the Surface reports. It decides when
both halves are present and settled, waits the period the library needs after
mounting before it will accept writes (the measured 250 ms, now a constant
inside the view with a test), paints once, repaints on a real grid change, and
owns cursor visibility and keyboard focus for its Pane. A view can lose its
Surface and gain a new one; gaining one triggers a fresh resync exactly as a
first paint does. Base64 encoding for the library's `write` moves behind the
Surface adapter. The seam is justified by two adapters: the library view in
production and a recording fake in tests.

- [x] The Terminal Screen holds no Map of Surfaces or of Pane grids and no
      `paintWhenReady`; the slot component hands the Surface and each reported
      grid to the Pane's view and nothing else
- [x] Unit tests with a recording fake Surface and the existing fake clock
      cover: Surface before grid, grid before Surface, pre-layout grid then
      real grid (painted once, at the real one), a later real grid repaints,
      and nothing is written before the post-mount settling period has passed
- [x] A unit test asserts the cursor is hidden for an inactive Pane and stays
      hidden after a chunk that asks for it back, and shows again when the
      Pane becomes active; cursor visibility is set from one place
- [x] A unit test asserts losing the Surface stops writes and gaining a new
      one resyncs from a fresh capture
- [x] Focus and blur go to the view of the active Pane and through it to its
      Surface; a unit test asserts the toggle asks the Surface whether it is
      focused rather than a global listener
- [~] The Dock's keyboard button still points the right way on the device
- [~] On the device, unzooming a two-Pane Window shows both Panes painted, and
      splitting from the Panes sheet shows the new Pane painted without typing
      into it first
- [x] The Dock's keyboard-inset comment no longer explains itself by an
      Accessory Bar that is turned off
