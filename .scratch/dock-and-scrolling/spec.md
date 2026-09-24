# The Dock, the keys it was missing, and how scrolling feels

Three asks, arriving together once the split work had landed and the app was
being used rather than built.

1. **The Dock is one long row and reads as one.** It should be groups: the
   Session/Window/Pane pickers are one kind of thing and Home/Keyboard another.
   The buttons also sit further apart than they need to.
2. **There are no modifier keys at all.** ADR 0003 dropped them because the
   terminal library drew its own bar above the keyboard; that bar is now turned
   off because it covered the Dock. So a third group, on the left, called Meta,
   opening a menu of the keys a phone keyboard does not have.
3. **Scrolling stops dead.** It should carry on and slow down, the way every
   other scroll on the phone does.

Not asked for, and deliberately not built: a permanent second row of keys. The
brief said a button that opens something, and a row that stays up costs the
Surface two lines it cannot spare on a phone.
