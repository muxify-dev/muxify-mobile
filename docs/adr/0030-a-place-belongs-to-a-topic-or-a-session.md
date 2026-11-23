# A Place belongs to a Topic or a Session

ADR 0020 gave the phone a Topic Place, so a Topic opened again goes back to its
Window, Pane and Browser Tab, and Back from a Topic's Web View can go to the
Host Screen without losing the page. A Session with no Topic had none: its Web
View sat over the Terminal Screen, Back went there, and the page was lost. We
give a Session with no Topic the same thing, as one record kind: a Place, whose
owner is a Topic or a Session (keyed by the Session's name). The Attach's one
writer and one restore serve both kinds, and the Web View has one rule: it
takes the Terminal Screen's place, and Back keeps its Tab in the Place.

## Considered Options

- **A second record, `sessionPlaces`, next to `topicPlaces`.** No migration of
  the records file, but two writers and two lookups in the Attach and in each
  opener, which would drift apart again.
- **The Tab only, with no Window and Pane.** The page would come back on
  whatever Window the Mac left active, which may not be the Tab's Window.
- **No record: only make Back go to the Host Screen.** Back would throw the
  page away. In a Topic, Back is safe only because the Place brings it back.

## Consequences

- The owner is what the Attach holds. When the current Topic lists the
  Session the user picks, the Attach keeps the Topic, and the Topic Place
  applies. A Session opened from the Sessions tab, a Board Session card or Go
  to has no Topic, and its Session Place applies.
- The screen that opens the Place opens the Web View of its Tab: the Host
  Screen, when the user opens a Topic or a Session, or the cold start's choice
  of route. The Terminal Screen does not come first to open it. The Web View
  then reads the Window's Tabs, and checks that the Host still lists its Tab.
- The records file's `topicPlaces` became `places`. A build from before this
  change finds no Topic Places in a file that a later build wrote.
- A renamed Session starts with no Session Place, and opens on the Terminal
  Screen.
