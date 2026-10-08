# claude-mods

Polar's Claude Code mods, as one plugin marketplace (`polar-mods`) with three plugins:

| Plugin | What it does |
| --- | --- |
| [user-hud](plugins/user-hud) | A control panel tucked into the corner above the prompt: prompt-cache countdown with a 2-minute keep-warm alert (a macOS alert with a Keep warm button), model and effort pickers, quick settings, and Write / Read handoff buttons. |
| [code-reference](plugins/code-reference) | Replies that point at code. Ask with `/code-reference` (or review a PR) and the reply comes back as prose linked to the code, a row of numbered boxes under each section; a click shows that code in a pane beside it, read from disk. Drawn the same in the terminal and the desktop app. Was pr-review-ui. |
| [ask](plugins/ask) | A side chat in a pane that forks the main chat to answer, so it knows the whole session; nothing goes back unless you send it (`s`). It scrolls, and draws Mermaid diagrams: box art in the terminal, SVG in the desktop app. `/ask`, `/draw`. |

user-hud draws on the band above the prompt; code-reference and ask draw in panes of their own, so they work together or alone.

## Install

In a terminal:

```
claude plugin marketplace add hyperbola-bear/claude-mods
claude plugin install user-hud@polar-mods
claude plugin install code-reference@polar-mods
claude plugin install ask@polar-mods
```

Then start a new Claude Code session. Mods need Claude Code 2.1.287 or later.

## Update

Two plugins were renamed. If you installed either under its old name, swap it once:

```
claude plugin uninstall user-hd@polar-mods
claude plugin install user-hud@polar-mods
claude plugin uninstall pr-review-ui@polar-mods
claude plugin install code-reference@polar-mods
```

user-hud was user-hd before 1.2.0; code-reference was pr-review-ui before 2.0.0.

Then, for every update:

```
claude plugin marketplace update polar-mods
claude plugin update user-hud@polar-mods
claude plugin update code-reference@polar-mods
claude plugin update ask@polar-mods
```

## Develop

Each plugin has its own tests:

```
claude plugin validate plugins/user-hud && claude plugin test plugins/user-hud
claude plugin validate plugins/code-reference && claude plugin test plugins/code-reference
claude plugin validate plugins/ask && claude plugin test plugins/ask
```
