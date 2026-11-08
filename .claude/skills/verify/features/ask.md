# ask

A side chat in a pane beside the transcript. It answers from a fork of the main chat, draws Mermaid diagrams as box art in the terminal and as vector lines on the desktop, and sends nothing to the main chat unless the person sends an answer.

## Sub-features

- `ask-open` opens the pane with `/ask`.
- `ask-question` answers a question typed with the command or in the pane's field.
- `ask-draw` answers with a diagram first for `/draw` or draw mode (`d`).
- `ask-tables` keeps tables inside the pane: the answer is told its width, and a table still too wide is redrawn with wrapped cells, or as a list where too narrow.
- `ask-layout` sets each question apart with a faint line under it, and keeps every command in one bar at the bottom, wrapping to fit.
- `ask-scroll` scrolls long answers with the wheel, the arrows and the page keys while the bar stays at the bottom (docked).
- `ask-send` sends an answer to the main chat (`s`: the answer whose `❯` was picked, else the newest), and only then.
- `ask-copy` copies an answer (`❯` or `c`).
- `ask-rewind` takes back the newest question and answer, one at a time, and keeps the rest (`/ask-rewind`, `r`).
- `ask-clear` empties the pane (`x`).

## How to get to it (user POV)

- Type `/ask` or `/ask <question>` at the prompt.
- Type `/draw <subject>` at the prompt.
- Type `/ask-rewind` at the prompt. `/rewind` is Claude Code's own command for the main chat, and the pane never touches it.
- With the pane focused, press `i` for the field, `d`, `s`, `c`, `o`, `r`, `x`.

## Driving it with tui.sh

Preconditions:

- `tui.sh start ask 140 45` is ready and the doctor passed.
- The session has run one turn, so there is a chat to fork. Type `tui.sh type ask "say hi"` and wait for the reply.

- **Open.** Run `tui.sh type ask "/ask"`. A pane titled `ask` docks beside the transcript with the field `❯ ask about the session`.
- **Question.** Run `tui.sh type ask "/ask what did I just say?"`. Within 30 seconds the pane shows an answer and a footer starting `fork ·`.
- **Diagram.** Run `tui.sh type ask "/draw the request flow"`. The answer starts with box-drawing characters (`┌`, `─`, `▼`) sized to the pane, none wider than it.
- **Pinned bar.** Ask for a long answer (`/ask list ten facts about tmux, one short paragraph each`), Shift-Tab off the field (`tui.sh keys ask BTab`), then `tui.sh keys ask PageUp` and `PageDown` twice. The answers move; the `═` line, the field and the commands stay on the same rows. At the end the last footer sits two rows above the `═` line. Each question has a `─` line the width of the pane under it.
- **Send.** Focus the pane and press `s` with `tui.sh keys ask s`. The transcript shows one line saying what was sent, and the answer's footer says `sent to the chat`.
- **Not sent by default.** Ask a second question and don't press `s`. The main chat's next reply doesn't mention it.
- **Rewind.** With two questions in the pane, run `tui.sh type ask "/ask-rewind"`. The transcript says `Took back "<second question>" and its answer`, the header reads `1 question`, and the first question stays. Then ask `what was my last question in this pane?`: the answer names the first question, not the one taken back.
- **Rewind keeps the focus.** Focus the pane on its question's `❯` and run `tui.sh keys ask r`, then type a word with `tmux send-keys -l`. The word lands in the pane's field, not in the main prompt. Check both with one question left and with two.
- **Tables.** Run `tui.sh type ask "/ask compare the files you changed in a table: file, what changed, why"`. No table row is wider than the pane and no border breaks across lines. Narrow the pane (`tui.sh resize ask 90 45`): the same answer redraws with its cells wrapped, or as a bold-led list once the columns would be under 8 cells.
- **Width.** Run `tui.sh sweep ask pane 100 140 180`. The diagram redraws at each width and no row exceeds the pane.
- **Proof.** `tui.sh shot ask answer` after the diagram, and the same view on the desktop as a screenshot.

On the desktop, drive the same steps through computer use. The diagram there is drawn as vector lines from the same layout. Compare its boxes and labels with the terminal capture, not its pixels.

## Gotchas

- The pane scrolls its answers itself and estimates their height from the text. A surface only reports a scroll when its window has room to move, so the pane keeps a spare row above and below and parks the window on row 1. If the end can't be reached, or stops far past the last answer, check the estimate in `hooks/layout.ts` before the scrolling.
- The desktop draws a unit of margin as half a row, so the answers' margin is twice the rows there (`spacePerRow`), and its proportional font fits about 1.3 times the columns it reports (`textColumns`).
- In the field, the page keys and arrows edit the field and don't scroll. Shift-Tab or a click on a `❯` gives them to the answers.
- Before the session's first turn there is nothing to fork. The answer is marked `live` and comes from a plain completion instead.
- The terminal docks the pane only in fullscreen layout and at enough width. Below the docking width it isn't placed at all.
- `o` opens a browser. Don't press it during an unattended run.
