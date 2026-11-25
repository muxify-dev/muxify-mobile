# A Sessions only that can pass is tried again on the same Connection

ADR 0025 made Sessions only last for the rest of a Connection: "The next Connection tries the Host Server again. Nothing retries in the background." When it was written, a return from the background dropped every Connection that no Attach held, so a next Connection came soon. Two later decisions keep a Connection much longer. ADR 0028 keeps a slow link that still brings Pane output, and ADR 0031 keeps a Connection whose Host Server answers a `ping`. A Connection that an Attach holds can now live for hours. A user reported that the Sessions menu said Topics were unavailable until they signed in again or started the app again. Both of those make a new Connection.

Two causes of Sessions only can pass while the Connection lives: no `hello` within 10 s, and 3 stops within 60 s. A slow link after a return from the background can cause either. When iOS suspends the app for more than 45 s, the Host Server exits, because nothing reaches it. Its restart then meets the slow link. The other causes need another `muxify`: a Host CLI that is too old or missing, or a phone that is too old. The install already starts the server again when it puts a new `muxify` on the Host (ADR 0016).

So a Sessions only that can pass is tried again on the same Connection, with a new budget of 3 stops:

- **On a return from the background**, for a Connection that an Attach holds. This is the moment when the Attach already checks the link (ADR 0028) and the Listing subscribes again (ADR 0031). A Connection that no Attach holds and whose Host Server is not live is still dropped.
- **On a screen's use of the Connection**: a read, a write, a hold or a Host Server request, when the Sessions only began 60 s (`STOP_WINDOW_MS`) or more before. Opening the Title Sheet reads the Host, so the Sessions menu asks again. Without the 60 s, a screen that reads again on each Sessions only, as the Host Screen's Sessions list does, would start the server in a loop.

Nothing retries on a timer. A Sessions only that needs another `muxify` stays until the install or the next Connection.

## Considered Options

- **Drop the Connection when its Host Server gives up.** The Attach would lose a working terminal to fix a side channel.
- **Retry on a timer with backoff.** It works while nobody looks, and it writes to a Host that the user is not using. The return and the next use come when the user wants Topics.
- **Retry on every use, with no wait.** The Host Screen's Sessions-only read would start the server again each time it fails, in a loop.
