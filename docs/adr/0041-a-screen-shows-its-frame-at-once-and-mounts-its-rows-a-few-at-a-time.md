# A screen shows its frame at once, and mounts its rows a few at a time

## Problem

The app froze when a screen changed. In a Release build on the iPhone 17
simulator, Time Profiler showed these main-thread hangs:

- Open Go to: 465–590 ms.
- Close Go to: 450–500 ms.
- Open the Host Screen: no hang over 250 ms, but 660–810 ms of main-thread
  CPU in the push.

The JS thread used 35–135 ms in the same windows. 59% of the hang time was
React Native mounting views into Expo UI's SwiftUI views, and most of that
was Combine's `ObservableObject` work for each view. A row costs about 9 ms
of main-thread time. Go to replaced about 35 Board rows with about 95 Go to
rows in one render, and its close did the reverse. While the main thread is
busy, no tap and no key gets through.

Go to also opened with the rows of an earlier read. The Host Screen asked
for the Go to list when it got the focus, and Go to seeded a cached list
from an earlier visit. The user saw old rows and no progress line.

## Decision

- **A screen shows its Screen Frame at once.** The Screen Frame is the part of a screen
  that the user acts on before the content comes: the header with Back,
  the title and Options, the tabs and the Go to bar. It mounts in the
  render of the tap, and it takes taps and keys at once. The content area
  shows its progress line until its rows come.
- **A list mounts its rows a few at a time.** `useRowBudget` gives each
  list a number of rows to mount. It adds a few rows in each animation
  frame until the rows fill the screen, then stops. A row at the end of the
  list starts the next screenful when it appears, as the user scrolls. No
  render mounts more than a few rows, so the main thread stays free for
  the keys and the animation.
- **A pushed screen mounts its rows after the push.** The rows start when
  the push animation ends, so the animation does not share its frames with
  them.
- **Go to has its own list, over the tab.** The tab's rows stay mounted
  under Go to. Opening Go to mounts only the Go to rows, and closing it
  only removes them. The Go to list is new at each open, so it starts at
  the top.
- **Each open of Go to is a new search.** Go to opens with the field, the
  keys and a progress line, and with no rows. It asks the Host when it
  opens, not when the Host Screen gets the focus. A keystroke while the read
  runs replaces the read and cancels it on the Host Server, as ADR 0040
  says. Inside one search, the rows of the last answer stay through the
  next keystroke, as ADR 0040 says.

## Considered Options

- **Mount all rows after the animation.** Rejected: the hang moves, but it
  stays. The user cannot type while the rows mount.
- **A React Native `FlatList` for long lists.** It mounts only the rows on
  screen. Rejected for now: the rows would leave SwiftUI's `Form`, and its
  look, its swipe actions and its context menus. The row budget keeps
  SwiftUI and fixes the hang.
- **Keep the cached Go to list for a fast first paint.** Rejected: the user
  reads old rows as the answer, and acts on them.

## Consequences

- A list longer than a screen mounts its far rows only when the user
  scrolls to them. VoiceOver and a test see only the mounted rows.
- Return in Go to before the first answer waits for it, as ADR 0040 says
  for a read that runs.
- The Go to caches on the device, their seed and the hold of an empty-field
  answer go away. Nothing shows old rows any more, so nothing needs them.
- Each new screen follows the same rule: frame first, rows by the budget.
