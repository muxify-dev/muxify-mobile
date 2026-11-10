# Verify left-edge Back on iOS 26

Status: open

A rightward drag from the left edge does not leave the Terminal Screen in the
iOS 26.3 simulator. The native Back button does return Home and keeps the
Attach alive.

## Comments

The driver sent a pan from x10, y400 by 350 points to the right over 400 ms,
after the program label appeared and a one-second wait. Home did not appear.
The check failed with both the phase 9 native Header and the previous Header
from commit `6c56923`. The root restored the current files byte for byte after
the baseline check.

Evidence is in `/tmp/muxify-impl-handoff.Sc0532/phase9-edge-final.log` and
`phase9-edge-baseline.log` in the same folder. The current check used the
rename fix in both runs. This is not a regression from the native Header.
The native delegate permits an edge gesture, so a later investigation must
observe gesture recognition and Surface arbitration on the device. No native
patch or gesture policy change is part of this UX task.
