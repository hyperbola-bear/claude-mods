# ask

A side chat in a pane beside the transcript. It answers from a fork of the main chat, draws Mermaid diagrams as box art in the terminal and as vector lines on the desktop, and sends nothing to the main chat unless the person sends an answer.

## Sub-features

- `ask-open` opens the pane with `/ask`.
- `ask-question` answers a question typed with the command or in the pane's field.
- `ask-draw` answers with a diagram first for `/draw` or draw mode (`d`).
- `ask-scroll` scrolls long answers with the arrow and page keys.
- `ask-send` sends an answer to the main chat (`s`, or `→ send to chat`), and only then.
- `ask-copy` copies an answer (`❯` or `c`).
- `ask-clear` empties the pane (`x`).

## How to get to it (user POV)

- Type `/ask` or `/ask <question>` at the prompt.
- Type `/draw <subject>` at the prompt.
- With the pane focused, press `i` for the field, `d`, `s`, `c`, `o`, `x`.

## Driving it with tui.sh

Preconditions:

- `tui.sh start ask 140 45` is ready and the doctor passed.
- The session has run one turn, so there is a chat to fork. Type `tui.sh type ask "say hi"` and wait for the reply.

- **Open.** Run `tui.sh type ask "/ask"`. A pane titled `ask` docks beside the transcript with the field `❯ ask about the session`.
- **Question.** Run `tui.sh type ask "/ask what did I just say?"`. Within 30 seconds the pane shows an answer and a footer starting `fork ·`.
- **Diagram.** Run `tui.sh type ask "/draw the request flow"`. The answer starts with box-drawing characters (`┌`, `─`, `▼`) sized to the pane, none wider than it.
- **Send.** Focus the pane and press `s` with `tui.sh keys ask s`. The transcript shows one line saying what was sent, and the answer's footer says `sent to the chat`.
- **Not sent by default.** Ask a second question and don't press `s`. The main chat's next reply doesn't mention it.
- **Width.** Run `tui.sh sweep ask pane 100 140 180`. The diagram redraws at each width and no row exceeds the pane.
- **Proof.** `tui.sh shot ask answer` after the diagram, and the same view on the desktop as a screenshot.

On the desktop, drive the same steps through computer use. The diagram there is drawn as vector lines from the same layout. Compare its boxes and labels with the terminal capture, not its pixels.

## Gotchas

- Before the session's first turn there is nothing to fork. The answer is marked `live` and comes from a plain completion instead.
- The terminal docks the pane only in fullscreen layout and at enough width. Below the docking width it isn't placed at all.
- `o` opens a browser. Don't press it during an unattended run.
