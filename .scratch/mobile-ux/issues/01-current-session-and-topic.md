# Keep the current Session and Topic with the Attach

Status: resolved

The Attach holder compares an opening request with the Session name saved when the Attach was created. A Session switch does not update that saved name. The Terminal Screen also reads its Topic from route parameters, while a Session switch clears the Topic in Last Place.

Phase 6 must read the current Session from the Attach and keep its current Topic in Attach state. The Header, Title Sheet, and Last Place must use that same Topic. Test a switch to another Topic, a sibling Session, a plain Session, and reopening the original Session.

## Comments

The phase 6 architecture review found the stale holder comparison in `src/tmux/attach-holder.ts`. This issue is within the accepted Topic navigation change.

## Answer

The Attach owns a Session destination and its current Topic read. The holder
uses the current Session name. The Header, Title Sheet, and Last Place read
that state. Unit tests cover sibling and plain picks, Topic changes, holder
reuse, reconnect, and late Session notifications. Simulator checks passed for Topic entry, sibling switches, Last Place,
cold starts, forms over the Terminal, and plain Session creation.


Independent review also found delayed card delivery, missing origin capture
for an Empty Topic opened over Terminal, opens during Disconnect, and a
superseded switch that still allowed a Window command. Delivery now checks the
origin and screen focus after asynchronous work. Disconnect holds the open
guard through Last Place removal. Superseded switches refuse dependent actions.
The regression tests cover these cases. New Session also shows Retry Attach
and stops name edits after creation succeeds.


The final review found that close during a switch's final refresh could still
report success. The switch now checks its generation before returning and
ignores a stale refresh error. Plain Session rows now share the Topic entry
hook's focus and origin checks. Reconnect keeps its requested Session name
through a failed lookup and clears route parameters only after acceptance.
