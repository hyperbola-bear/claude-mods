# code-reference

Replies that point at code. `/code-reference` makes the answer plain prose whose words link to places in the code, with a row of numbered boxes under each section. A place opens in a code pane beside the reply, read from disk.

## Sub-features

- `cr-explain` answers a question in the linked-prose format.
- `cr-redraw` redraws the previous reply in place when it already names files.
- `cr-place` shows place N in the pane (`/code-reference 5`, a click on a box or a link).
- `cr-pane-keys` scrolls the pane and steps through places (`a`, `d`, arrows), opens the editor (`e`).
- `cr-review` reviews a PR (`/code-reference review`, a PR URL or number) from a review worktree.
- `cr-inline` shows the code under its section when the pane is closed or can't dock.

## How to get to it (user POV)

- Type `/code-reference <question>` at the prompt.
- Type `/code-reference` alone after a reply that names files.
- Type `/code-reference review`, `/code-reference review <n>` or `/code-reference <PR URL>`.
- Click a numbered box or a linked word in the reply.

## Driving it with tui.sh

Preconditions:

- `tui.sh start cr 140 45` is ready and the doctor passed. The session's folder is this checkout, so the places resolve.

- **Explain.** Run `tui.sh type cr "/code-reference how does the band choose its width"`. The reply's header reads `● code-reference · claude-mods · N places in the code`, the prose has numbered links, and each section ends in a row of boxes `╭─ 1 ─…╮`.
- **Place.** Run `tui.sh type cr "/code-reference 1"`. A pane opens with a header naming place 1 and its path. The place's lines carry `▌`.
- **Step.** Focus the pane and run `tui.sh keys cr d`. The header moves to place 2.
- **Width.** Run `tui.sh sweep cr reply 80 120 160`. The prose rewraps and the boxes stay on one row, cut with `…` when they don't fit. None wider than the reply.
- **Proof.** `tui.sh shot cr pane` with the pane open, and the desktop's screenshot of the same reply.

On the desktop, the same steps through computer use. Both draw the reply and the pane in the app's monospaced face, so the boxes must sit under their labels exactly as in the terminal capture.

## Gotchas

- Only the command triggers the format. A prompt mentioning `/code-reference` mid-sentence doesn't.
- A review needs the GitHub CLI, a GitHub MCP server or git credentials. Without any of them it says so and stops.
- The review worktree lives in `~/.cache/code-reference/review/` and is removed when the session ends. Don't delete it during a run.
