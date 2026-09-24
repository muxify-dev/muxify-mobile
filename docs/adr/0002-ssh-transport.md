# SSH transport: @osuki-dev/react-native-ssh

Muxify needs an interactive PTY channel from React Native on iOS, and there is
no first-party Expo SSH module. We picked `@osuki-dev/react-native-ssh` (russh
via Nitro Modules) despite it being two weeks old at `0.3.0` with a single
author, because it is the only option whose shape actually fits: a PTY shell
with `onData`/`write`/`resize`, zero-copy `ArrayBuffer` streaming, a
`verifyHostKey` callback we control, prebuilt device **and simulator** slices,
and Expo autolinking with no config plugin. Its API maps one-to-one onto
`expo-libghostty`'s `write()` / `onInput` / `onResize`.

## Considered Options

- **`@dylankenneally/react-native-ssh-sftp`** — the maintained, established one.
  Rejected on three counts: it is an old-architecture bridge module riding the
  interop layer on an RN 0.86 project that is new-architecture by default; it
  **does not support the iOS simulator**; and its own README states host key
  verification is not performed.
- **`@fressh/react-native-terminal`** — SSH, VT engine and renderer in one, and
  its "bytes never cross JS" design is no longer disqualifying now that we are
  not parsing control mode. Rejected: **no license is declared on the repo**, it
  is three months stale, and adopting it means dropping `expo-libghostty`, which
  is the thing this probe exists to evaluate.
- **WebSocket relay to a server-side bridge** — genuinely lower risk on the
  mobile side. Rejected for this probe: it requires deploying and securing a
  daemon, and it terminates SSH off-device, which changes the trust model and
  breaks the "connect to any host" story.
- **Pure JS (`ssh2`)** — not viable. It needs `crypto.diffieHellman`,
  `generateKeyPairSync` and `KeyObject`; Hermes has none of them and no
  browserify shim implements them.

## Consequences

Transport is the project's largest single risk, and that is accepted
deliberately — establishing whether this stack holds together is the point of
the probe. Versions are pinned exactly and the lockfile is committed. If the
library is yanked or force-pushed, the fallback is the WebSocket relay, not
another npm package.
