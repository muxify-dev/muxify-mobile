# The phone installs the Host CLI on its own channel

The phone reads and changes a Host's Topics only through the Host CLI. A Linux Host, or a Mac without Muxify.app, has none until desktop Muxify connects to it. We decide that the phone installs and updates the Host CLI itself, once per Connection. It runs the install script that muxify-shell publishes beside the binaries on the rolling `cli-latest` GitHub prerelease: `curl -fsSL <base>install.sh | sh -s -- <base>`, falling back to `wget -qO-`. The base is `https://github.com/muxify-dev/muxify/releases/download/cli-latest/`.

- **Its own channel.** The install runs on a separate non-PTY channel on the Host's Connection, as a Composer upload does (ADR 0011). Its timeout is about 3 minutes, and it does not go through the 8 s screen-exec deadline of ADR 0012. A download of a static binary of tens of MB can outlast 8 s, and that deadline would mark a healthy Connection suspect and drop it. A failed or timed-out install never touches the Connection or the Attach.
- **The Topics read does not wait.** It reads with the Host CLI that is there. When the install answers `installed` or `updated`, the phone forgets the cached `muxify` path and reads again. While it runs on a Host with no Host CLI, or an old one, the Topics section says "Installing Muxify on this Host…" or "Updating Muxify on this Host…". A `failed:` answer shows its reason.
- **One script, not a copy.** The script's rules, its result lines and the contract (asset names, `muxify --version`, `~/.local/bin`, a newer CLI never replaced, a `muxify` inside Muxify.app left alone) belong to muxify-shell (its ADR on installing the Host CLI). The phone keeps only the one-line bootstrap and the parsing of the result line.
- Every result line goes to the Log. There is no setting to turn the install off.
- A dev build reads `EXPO_PUBLIC_MUXIFY_CLI_BASE_URL` in place of the base, so a test can serve a local build; a release build ignores it.

## Considered Options

- **A copy of the script in the phone.** Rejected: nothing checks one repository against the other, so the copies would drift, and a fix would wait for a phone release.
- **A screen exec with a longer deadline for this one command.** Rejected: the deadline is how the registry finds a dead Connection. A long exec on the shared path would hide a dead Connection for minutes.
- **The phone downloads the binary and uploads it over SSH.** Rejected: it sends tens of MB over a cellular link that the Host's own network does faster, and needs a binary for each Host architecture on the phone.
- **Wait for desktop Muxify to install it.** Rejected: a Host the user reaches only from the phone would never get one.
