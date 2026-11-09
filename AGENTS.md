# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

## tmux in tests and verification

The default tmux server (socket `${TMUX_TMPDIR:-/tmp}/tmux-<uid>/default`) and any server the user started with `-L` or `-S` are the user's live work. Every test, script, probe and Muxify copy you start talks to a **throwaway server** only. `e2e/sandbox.sh` does this for you: run every e2e suite and every one-off tmux probe through it. If you must start tmux some other way:

- Give each run its own directory. Set `TMUX_TMPDIR` to it, and remove `TMUX` and `TMUX_PANE` from the environment of every process you start. tmux uses the socket in `$TMUX` before `TMUX_TMPDIR`, so a leftover `TMUX` sends the command to the user's server.
- Before you run `kill-server`, `kill-session`, `kill-window` or any other destructive step, run `tmux display -p '#{socket_path}'` with the same environment. Continue only when the path is inside your run directory.
- When you finish, stop your own processes by PID and run `kill-server` on your throwaway server only.

Never kill or change Sessions on the user's default server, and never stop or restart the user's `/Applications/Muxify.app`. If a check needs the real server, stop and ask the user.

## Agent skills

### Issue tracker

Issues and specs live as markdown files under `.scratch/<feature-slug>/`. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context — `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
