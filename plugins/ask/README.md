# ask

A side chat in a pane beside Claude Code's transcript. It reads the main chat, scrolls, and answers with diagrams when a picture explains better. Nothing goes back to the main chat unless you send it.

```
┌ transcript ───────────────────────┬ ask ─────────────────────────────────────┐
│ ❯ refactor the cache layer        │ ❯ how does prompt caching work here?     │
│ ● Reading src/cache/*.ts …        │ Each request sends the whole chat; the   │
│   Edit(src/cache/store.ts)        │ cached part is read, not billed again.   │
│                                   │ ┌─────────────────┐                      │
│                                   │ │You send a prompt│                      │
│                                   │ └────────┬────────┘                      │
│                                   │          ▼                               │
│                                   │ ◇─────────────────◇                      │
│                                   │ │  Prefix cached? ├───no───┐             │
│                                   │ ◇───────yes───────◇        ▼             │
│                                   │ fork · 1.2 s · read 48210 · new 30 · out │
│                                   │ 410  → send to chat                      │
│                                   │ ❯ ask about the session        ⏎ ask     │
│                                   │ i: ask  d: draw: off  s: send to chat  … │
└───────────────────────────────────┴──────────────────────────────────────────┘
```

## Use

| | |
|---|---|
| `/ask` | open the pane |
| `/ask how is auth wired?` | open it and ask |
| `/draw the request flow` | ask for a diagram first, then a few sentences |
| Enter (in the field) | ask; the focus moves to the question's `❯`, so the keys scroll |
| ↑ ↓ PgUp PgDn, the wheel | scroll the answers |
| `i` | back to the field |
| `d` | draw mode: every question asks for a picture |
| `s` | send the newest answer to the main chat as context |
| `→ send to chat` (under an answer) | send that answer |
| `❯` (Enter or click on it) | copy that answer |
| `c` | copy the newest answer |
| `o` | open the newest answer's diagrams full size in the browser |
| `x` | clear the pane |
| Esc, ctrl+x tab | back to the chat, and back to the pane |

A question that starts with "draw", "diagram", "sketch", "visualize" or "chart" asks for a picture too.

## The main chat's context

- **Main chat → pane, always.** Each question is answered by a fork of the main chat (`$.model.fork`): the same model, system prompt and transcript, tool calls and results included, served from the main chat's prompt cache. The fork can't run tools. Before the session's first turn there is nothing to fork, so a plain completion over the transcript text answers instead, marked `live`.
- **Pane → main chat, only when you send it.** Side questions don't add to the main chat's context. To share one, press `s` (the newest answer) or `→ send to chat` under any answer. It's added as a note Claude reads on its next step, marked as context you chose to share and not a request; the transcript shows a line saying what was sent, and the answer's footer says `sent to the chat`. Sent during a turn, Claude picks it up on that turn's next step.
- **The pane's own history.** So that follow-up questions work, each fork also carries the pane's recent questions and answers that the main chat doesn't have. A sent exchange stops being carried once a main turn that started after it has ended.

## Diagrams

Answers are Markdown with ` ```mermaid ` blocks. Mermaid is the diagram language Claude writes most reliably, and it's text, so it travels through the main chat and git as is. The pane draws it with [beautiful-mermaid](https://github.com/lukilabs/beautiful-mermaid), which needs no browser:

| Where | Flowchart, state, class, ER | Sequence, xychart |
|---|---|---|
| Terminal | Box drawing sized to the pane's width; a left-to-right flowchart too wide for it is turned top-down | Box drawing |
| Desktop app | The box drawing's layout redrawn as vector lines (SVG) | beautiful-mermaid's own SVG |
| `o`, either one | Mermaid itself in the browser, every diagram type | same |

Every diagram draws on its own light or dark background, following the system theme. Pie, gantt, mindmap and the other Mermaid types the pane can't draw show their source, and `o` still opens them full size.

beautiful-mermaid's SVG for flowcharts and state, class and ER diagrams needs elkjs, which is 1.6 MB. A mod can import files only up to 1 MB, so elkjs is left out (`scripts/vendor.sh`), and those types are drawn from the box-drawing layout instead.

## Options

Set under `/config`, or in `settings.json` as `pluginConfigs["ask@polar-mods"].options`:

| Option | Default | |
|---|---|---|
| `liveModel` | `haiku` | Model for answers before the first turn. Forks always use the session's model. |
| `keep` | `30` | How many exchanges the pane keeps. |

## Cost

A fork reads the main chat's cached prefix (billed at the cache-read rate) and adds the question: a few hundred new tokens plus the answer. The main chat's context grows only by the exchanges you send it.

## Develop

```
claude plugin validate plugins/ask && claude plugin test plugins/ask
plugins/ask/scripts/vendor.sh   # rebuild hooks/vendor/beautiful-mermaid.js
```

The vendored bundle's licenses are in `hooks/vendor/LICENSES.md`.
