# delegator

Every subagent Claude starts waits in a dialog for the person's approval. Once it runs, the Delegator pane shows it as a pixel character beside its context battery, tokens, estimated cost, time and reported steps. A session that hands a plan out to agents reports it through `progress`, and a row above the prompt shows the plan while it runs.

## Sub-features

- `gate-dialog` holds each `agent.spawn` in a dialog: Approve, Approve all this turn, Change model, Refuse, or a typed note.
- `gate-refusals` refuses the agent when the dialog is dismissed or interrupted, nobody can be asked (`claude -p`), the dialog closes by itself, or the hook fails.
- `gate-suggest` shows a model for an agent Claude named none for: Haiku for lookups, Sonnet for building, Opus for design.
- `pane-waiting` lists the agents waiting and the first one's full task, with the line asking for steps.
- `pane-running` draws each running agent as its character (explorer, developer, architect, researcher, reviewer, Clawd), two frames 650 ms apart.
- `pane-done` lists finished agents (`✓`, `✗`) and refusals, newest first; `c` hides them.
- `pane-planned` lists the plan's tasks no agent has taken, with `after #n` for the ones they wait on.
- `step-tool` takes an agent's `step` reports (`2/4` and a note).
- `progress-band` shows the plan above the prompt (`<title> · <phase>  ▰▱▱ 1/3 accepted  ● 3 agents ▸`) until it finishes.
- `gate-switch` turns the gate off and on (`/delegator off|on`, `o`, `/config`).

## How to get to it (user POV)

- Ask Claude for any work it hands to an agent. The dialog opens in the prompt area.
- Type `/delegator` to open the pane, or click `● N agents ▸` on the band.
- With the pane focused: `o` turns the gate off or on, `c` hides or shows the agents done.
- `/config` has four rows: Approve subagents before launch, Suggest a model by task complexity, Animate the characters, Ask agents to report their steps.

## Driving it with tui.sh

Preconditions:

- `tui.sh start dlg 120 45` is ready.
- No other plugin that gates or tracks agents is on in this session. savvy-progress draws a band of its own above the prompt; leave it on only to check the two stack.

- **Pane, idle.** Run `tui.sh type dlg "/delegator"`, then `tui.sh wait dlg DELEGATOR`. The pane reads `DELEGATOR ● gate on`, `0 running · ≈$0.00 · 0 tokens · 0s` and the idle line.
- **Gate.** Send a prompt that reports a plan and launches one agent, for example: `First call mcp__delegator__progress with title 'verify run', phase 'delegate', total 1, tasks [{"title":"List plugin folders","tier":"light"}]. Then launch one Explore agent with description 'List plugin folders' that lists the folder names under plugins/ and reports them. Do nothing else.` Run `tui.sh wait dlg Approve 120`. The dialog asks `Launch #1 Explore "List plugin folders" on Haiku (suggested: lookup)?`. The pane shows `verify run · delegate`, WAITING with `▸ #1 Explore · List plugin folders · Haiku`, the TASK ending in the line about `mcp__delegator__step`, and PLANNED with `◷ 1. List plugin folders`.
- **Running.** Run `tui.sh keys dlg Enter` (Approve), then `tui.sh wait dlg "R U N N I N G" 30`. The agent's three rows sit beside the explorer's character, and the band reads `verify run · delegate  ▱ 0/1 accepted  ● 1 agent ▸`. A few seconds later the battery, tokens and cost have grown and the steps row reads `0/3` or similar.
- **Done.** Run `tui.sh wait dlg "D O N E" 120`. The row reads `✓ #1 Explore · List plugin folders` with its tokens and time, and the totals row says `0 running`.
- **Widths.** Run `tui.sh sweep dlg done 160 100 80 60`. Every width prints `fits in <cols> columns`. At 160 the pane docks beside the transcript. At 100 and under it is a framed box above the prompt, with delegator's band above user-hud's panel.
- **Band leaves.** Run `tui.sh type dlg "Call mcp__delegator__progress with done 1 and finished true. Nothing else."`. The tool answers `ok: verify run · finished, 1/1 accepted`, the pane reads `verify run · finished`, and no row above the prompt contains `agents ▸`.
- **Refuse.** Launch another agent the same way, press Down three times to `Refuse` and Enter. The caller is told the person refused, and DONE lists `✗ #2 … refused`.
- **Proof.** Keep `gate-dialog`, `running-120`, `done-*` and `flow-finished`, with their `.ansi` files for the character's colours.

On the desktop, run the same prompts in a Code session of this checkout. The dialog is the app's own question card. The pane opens in the side panel; compare its rows with the terminal capture at the matching width.

## Gotchas

- An agent costs real usage. Keep the task to one lookup and the model to Haiku.
- Every agent inherits the session's MCP tool list. On a machine with many MCP servers, one short lookup can hold 400k tokens of context and show a 40% battery. That number is real: check it against the agent's transcript under `~/.claude/projects/<project>/<session>/subagents/`.
- The pane prices cache writes at the 5-minute rate, which subagents write. The `≈` cost is still an estimate, not the subscription's charge.
- The character moves only while an agent runs. A capture of a done agent has no sprite.
- With the session in auto mode the gate still asks: the dialog is the plugin's, not a permission prompt.
