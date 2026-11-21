# The phone speaks Host Server protocols 1 to 2

ADR 0025 had the phone's `hello` carry protocol 1. The Host CLI's protocol 2 (muxify ADR 0098) adds only a `colours` request and a `focus` subscription, for a Mac on a Remote Environment, and its `min_protocol` is 2, so a phone that speaks only 1 fell to Sessions only and blamed the Host. We decide that the phone speaks the range 1 to 2 and answers the server's `hello` with the highest protocol both speak. The phone uses neither `colours` nor `focus`: it writes its Theme's colours on its own Control Connection (ADR 0026, "The screen in use writes the Theme's colours"), and a second path through the Host Server would write every Pane twice. When no protocol is shared, the reason names the side that is too old: "Muxify Mobile is too old for the Host's muxify (<build>). Update the app." when the server's `min_protocol` is above the phone's highest, with no "Updating Muxify on this Host…", since updating the Host cannot help; else "the Host's muxify is too old (<build>)", as before.

## Considered Options

- **Speak protocol 2 alone.** Rejected: every Host CLI from before protocol 2 would fall to Sessions only, for no gain.
- **Use `colours` and `focus` as the Mac does.** Rejected: see above.
