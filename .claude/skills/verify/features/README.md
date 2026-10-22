# Feature map

One file per mod. Each lists the mod's user-facing features, how a person reaches each, how to drive it with [`../scripts/tui.sh`](../scripts/tui.sh) and on the desktop, and what proves it works.

| Mod | What it draws | Entry |
|---|---|---|
| user-hud | the band above the prompt: closed row, cards, Sessions and Tokens panes | [user-hud.md](user-hud.md) |
| delegator | the approval dialog, the Delegator pane with each agent's character, the plan's row above the prompt | [delegator.md](delegator.md) |
| ask | the side-chat pane, with diagrams | [ask.md](ask.md) |
| code-reference | the code-reference pane beside the transcript | [code-reference.md](code-reference.md) |

## Before any entry

- The doctor in [`../SKILL.md`](../SKILL.md) passed for the surface you drive.
- Each scenario has its own tmux session name, and it is stopped at the end.
- The person's own Claude sessions keep running. Read them as data; never answer, start or stop them.

## Driving conventions

- Type what a person types: slash commands and prompts with `tui.sh type`, keys with `tui.sh keys` while the band or pane has the focus.
- Wait on text the screen shows (`tui.sh wait`), never on a fixed sleep alone.
- Capture before and after each action that changes state, and name captures by what they show (`gate-dialog`, `done-80`).
- Sweep the same widths on every entry: 48, 80, 120 and 160 for the band, 160, 100, 80 and 60 for panes. `sweep` reports any row wider than its window.

## Reporting proof

For each sub-feature you drove, report one line: its id, the surface, pass or fail, and the capture or screenshot that shows it. A sub-feature you did not drive is reported as not run, with the reason.

## Adding an entry

A new mod, or a new feature in one, gets its file or its lines here in the same change. Each file has four sections:

- **Sub-features.** One bullet per feature, with an id `<area>-<name>` and the key or command that runs it.
- **How to get to it (user POV).** Every way a person reaches the features: commands, keys, buttons, `/config` rows.
- **Driving it with tui.sh.** Preconditions, then one step per feature, each with the command to run and the exact text that proves it, then what to keep as proof. Close with the desktop route.
- **Gotchas.** What misleads a verifier: states that only appear after a first reply, numbers that look wrong but are real, things the harness cannot see.
