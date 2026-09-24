# Composer drafts belong to Panes; attachments travel over SSH

Muxify adopts Remux's compose-then-send interaction: text and attachments are
held in a Draft, attachments are uploaded to the Host, and their absolute paths
are pasted with the text into the destination Pane before a separate Enter.
The Composer stays open after Send. Each Pane has its own in-memory Draft,
owned by the Attach, so closing the Composer, going Home, or replacing a lost
Connection does not lose it. Explicitly closing the Attach releases its Drafts.

## Uploads without SFTP

The SSH library chosen in ADR 0002 does not expose SFTP. Replacing it would
reopen the transport decision for a feature that only needs to write files.
Instead, each attachment gets a separate, non-PTY channel on the existing
Connection. A small shell receiver writes raw bytes in 64 KiB chunks, checks
the cumulative file size, and acknowledges each chunk. Only then does the phone
read and send another. The library's synchronous `write` has no backpressure;
queueing an entire file would turn large attachments into unbounded memory use
and report queued bytes as upload progress.

The receiver uses `/bin/sh`, `head -c`, `wc`, `tr`, `mv`, and `base64`, available
on macOS and ordinary Linux Hosts. Base64 encodes only the returned absolute
path, not the file. A final explicit commit renames `.upload.part` into its
unique directory under `~/.cache/muxify/attachments/`. Cancellation or failure
closes the channel; the shell trap removes partial content when it can run.
Finalized remote files remain available to the receiving application.

This extends ADR 0006's transport description: **tmux commands** still go down
the Control Connection; file bytes go down an independent upload channel.
It does not create a second Connection or require a service on the Host.

## Delivery is not ordinary typing

The Surface's keyboard adapter deliberately strips bracketed-paste markers and
turns LF into Return. A Composer knows that its content is a paste. It uses a
uniquely named tmux buffer, filled in bounded chunks, then `paste-buffer -p -r
-d`: tmux brackets it if the destination requests that mode and preserves
newlines. Enter is sent separately after the paste settles, as in Remux.
The buffer payload is redacted from the Log, just like typed input (ADR 0010).

Send captures the Pane and Connection generation. Switching Pane cannot redirect
it; backgrounding or losing the Connection interrupts it. Failures before
delivery retain the Draft for retry. Once delivery starts, an interrupted reply
cannot tell whether the application received the text or Enter: the Composer
keeps the Draft, explains the uncertainty, and requires the user to check the
terminal before enabling Send again. It never automatically replays a message.

## Native paste is a small local module

React Native's text input does not expose clipboard-image paste. A local Expo
module owns a `UITextView`, intercepts the normal Paste action, and snapshots
image item providers immediately. Preparation is a module Promise rather than
a view callback, so switching Pane while an image loads cannot put it in the
new Pane's Draft. Text editing stays native; preparation, Drafts, upload and
delivery remain in TypeScript. Photos and Files use Expo's system pickers.

Only Draft state is in memory. Attachment bytes are owned temporary local files,
released on removal, successful Send, or Attach closure; stale staging is swept
on the next process's first use. Large files need not be held in JS memory.
