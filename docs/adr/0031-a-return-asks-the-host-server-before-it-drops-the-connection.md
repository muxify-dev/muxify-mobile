# A return asks the Host Server before it drops the Connection

ADR 0012 drops each Connection that no Attach uses when the app comes back to the foreground, and ADR 0025 kept that rule for the Connection a Host Screen holds. Keepalives stop while iOS suspends the app, so a Connection can die with nothing to say so. But most Connections live through a short background, and the drop made each return pay for a full SSH dial, a new Host Server, a `hello` and a new `snapshot` subscription. Until all of that finished, the Host Screen showed the old Topic list, drawn as if it were fresh.

So a return no longer drops a live Connection without a question. For each Connection with no Attach whose Host Server is live, the phone sends the Host Server one `ping`. An answer within 8 s (`EXEC_DEADLINE_MS`) keeps the Connection, and the Listing subscribes again on it: the first item of a `snapshot` subscription is the whole state, so one round trip makes the list fresh. No answer, or an error, drops the Connection as before. A Connection whose Host Server is not live is dropped as before. On a Connection an Attach holds, the Attach still decides (ADR 0028), and the Listing subscribes again too.

The Listing also subscribes again when the Host ends its subscription while the Host Server stays live, as the Host does with a subscriber that fell behind. It does so only for a subscription that brought at least one item, so a Host Server that refuses the subscription is not asked in a loop.

## Considered Options

- **Keep the drop, and only say that the list is old.** Honest, but every return still waits for a full dial.
- **Trust the library's flags.** ADR 0028 showed that they can say "connected" for minutes on a dead link.

## Consequences

- A `ping` cannot hang a return: 8 s with no answer ends it, as the Attach's probe does.
- The Host Screen can no longer count on a new Connection after each return, so the Listing feed says itself when its list may be old. When the app goes to the background, each feed records that moment as the last one at which the phone knew the list. The subscription that ran before the background stays, so that the return can cancel it, but its items no longer prove the list current: a buffered push or a push from a dead link can arrive after the return. Only the first item of a subscription made after that moment ends the doubt. A subscription that ends, or a Host Server that stops being live, starts a doubt the same way.
- The Host Screen says "Updating…" only when the phone has not known the list for 30 s and the current ask has run for at least 1 s from the return. With a good link the ping and the new subscription take a few hundred milliseconds, and a line that shows for that long is a flicker. "Not updated · <age>" measures the age from the last moment the phone knew the list, not from the last push, because a Host where nothing changed sends no push.
