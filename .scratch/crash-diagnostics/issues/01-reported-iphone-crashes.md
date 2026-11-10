# Preserve evidence for the reported iPhone crashes

Status: open

The user reported crashes after installing the Release build on iPhone 17 de Gleb.
The app kept its Log in memory, so the app Log did not survive those crashes.

Three iOS reports were copied from the phone on 2026-11-11.

- `/tmp/muxify-2026-11-10-225351.ips`
- `/tmp/muxify-2026-11-10-231505.ips`
- `/tmp/muxify-2026-11-10-231546.ips`

All three report SIGABRT on the React TurboModule queue. The latest report's
last exception stack includes `RCTExceptionsManager reportFatal` and
`RCTExceptionsManager reportException`. This shows that React Native reported
a fatal exception. The report does not include the JavaScript error message.
The cause remains unknown.

The diagnostic change must save app events and JavaScript fatal error details
before React Native terminates the process. It must also retain iOS diagnostic
payloads when MetricKit supplies them. A previous launch is not proof of a crash.

## Verification still needed

Reproduce the user's failure with the diagnostic build. Read its saved error
message and stack, then fix the cause. A process restart test only verifies
saved logs. It does not verify this crash or native report delivery.

## Diagnostic build verification

The standalone Release simulator app now preserves a controlled JavaScript
fatal error. The process terminated, and the next launch displayed and copied
the message and stack from Settings > Logs > Previous launch. Both ordinary
log persistence and native chooser controls passed their simulator checks.

The iPhone received the diagnostic build. The original crash still needs a
reproduction. MetricKit payload delivery on a physical device remains unverified.
