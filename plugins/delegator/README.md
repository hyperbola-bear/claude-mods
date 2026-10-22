# delegator

Every subagent Claude starts waits for your approval first. You see the task, the agent type and the model it would run on, and you approve it, refuse it, change its model, add a note to its task, or approve every agent for the rest of the turn. Once an agent runs, the Delegator pane shows it as a pixel character beside its context, tokens, estimated cost, time and the steps it reports.

```
┌ Delegator ─────────────────────────────────────────────────────────────┐
│ DELEGATOR ● gate on                                        o: Turn off │
│ 3 running · ≈$2.31 · 1.1M tokens · 6m 12s                 c: hide done │
│ verify skill · delegate                                                │
│ ── W A I T I N G  · 1 ──────────────────────────────────────────────── │
│ ▸ #7 Plan · lay out the verify skill · Opus                            │
│ ── T A S K   # 7 ───────────────────────────────────────────────────── │
│ Lay out the verify skill for polar-mods: one command per feature.      │
│                                                                        │
│ Report your progress to the person's Delegator pane: call              │
│ `mcp__delegator__step` with `total` (your plan in 3 to 8 steps) and    │
│ `done: 0` before any other work, then again with `done` and a few-word │
│ `note` as each step finishes.                                          │
│ ── R U N N I N G  · 3 ──────────────────────────────────────────────── │
│ ▄▄▀▀▀▀▄▄ #3 Explore · find session status files              Haiku 4.5 │
│ ▄█▀██▀█▄ ▕██▏       ▏ 22%  48k  ≈$0.02  41s                            │
│ ▄▀█▀▀█▀▄ 2/4 reading sessions/*.json                                   │
│                                                                        │
│  ▄▀▀▀▀▄  #5 general-purpose · port the agent panel            Opus 5.5 │
│ ▀█▀██▀█▀ ▕██████▎   ▏ 63%  412k  ≈$1.84  6m 12s                        │
│ ▄▀█▀▀█▀▄ 3/6 cells for the running list                                │
│                                                                        │
│  ▀████▀▄ #6 claude-code-guide · how Client cells paint      Sonnet 5.5 │
│ ▄█▀██▀█▄ ▕████████  ▏ 81%  650k  ≈$0.45  4m 03s                        │
│ ▄▀█▀▀█▀▄ no steps reported                                             │
│ ── D O N E  · 2 ────────────────────────────────────────────────────── │
│ ✓ #1 Explore · read savvy-progress                           31k · 38s │
│ ✗ #2 general-purpose · rewrite the tests                       refused │
│ ── P L A N N E D  · 1 ──────────────────────────────────────────────── │
│ ◷ 3. write the polar-mods verify skill                        after #5 │
└────────────────────────────────────────────────────────────────────────┘
                     verify skill · delegate  ▰▱▱ 1/3 accepted  ● 3 agents ▸

 Launch #7 Plan "lay out the verify skill" on Opus (suggested: planning)?
 ❯ 1. Approve                 Launch it as shown (full task in the Delegator pane). Or type below to add a note to its task.
   2. Approve all this turn   Launch this and every agent until this turn ends, unasked.
   3. Change model            Pick Haiku, Sonnet, Opus or Fable, then decide.
   4. Refuse                  Do not launch it; the caller is told you refused.
   5. Type something.
```

The pane is one grid of cells, the same in the terminal and the desktop app. In VS Code and on mobile it is the same rows as text, with buttons for its keys. Below 44 columns the characters are left out and each agent's text starts at the left edge. Every row is cut at the pane's width with `…`.

## Use

| | |
|---|---|
| **Approve** | launch it with the task and model shown |
| **Approve all this turn** | launch it, and every agent after it, until the main turn ends or you send another prompt |
| **Change model** | Haiku, Sonnet, Opus or Fable (or type `default` for the agent's own, or a full model id), then the question comes back |
| **Refuse** | nothing starts; Claude is told you refused and not to start it again unless you ask |
| type an answer | it's added to the agent's task as a note, under "Notes from the person who approved this agent", and the question comes back |
| `/delegator` | open the pane and say whether the gate is on, and how many agents wait and run |
| `/delegator off`, `/delegator on` | turn the gate off or on; so do the pane's **o** and `/config` |
| **c** in the pane | hide the agents done, or show them again |

## Which model

When Claude names a model for an agent, that's the one shown. When it doesn't, the delegator suggests one from the task:

| Task | Model |
|---|---|
| `Explore` and other lookup agents, or a description like "find", "list", "inspect", "summarize" | Haiku |
| building: "implement", "fix", "write", "refactor", "debug", "migrate", or no clear signal | Sonnet |
| `Plan`, or "design", "architecture", "root cause", "security", "audit" | Opus |

A task longer than 6,000 characters is never treated as a quick lookup. Turn **Suggest a model by task complexity** off in `/config` and an agent with no model named runs on its own default instead. A fork always runs on the parent's model, so its question has no **Change model**. An agent a workflow script starts can only be approved or refused, since the engine ignores edits to it.

## Nothing launches unapproved

- The dialog is the hold. A hook gets 10 seconds of its own time, and a hook that runs out is skipped, which would let the agent start. Waiting inside the engine's question dialog doesn't count against that time, so the agent can wait as long as you take.
- A dialog that is dismissed or interrupted, a run with no one to ask (`claude -p`), and a dialog that closes by itself while you're away all refuse the agent. If the hook itself fails, the agent is refused too.
- Several agents at once: the first one's dialog opens, and the others wait up to 6 seconds for its answer, so **Approve all** there covers them without more dialogs. After that, each one asks in turn.
- Turning the gate off doesn't release the agents already waiting. They still need an answer in their dialogs.

## The agents as they run

Every agent that launches is tracked, whether you approved it or the gate was off, on the number the queue gave it, so `#5` is the same agent in the dialog and in every part of the pane. The pane keeps the newest 200. `/clear` empties them along with the queue. They last through a `/config` change, which reloads the plugin (the pane's **o** is one). An agent with no loop in this session to report on, such as a workflow agent run remotely, is not shown.

- **Running.** Each agent shows as its character, then three rows: its number, type and task with its model on the right; its context battery, tokens, estimated cost and time; and the steps it reported, or `no steps reported`. The battery is the tokens its last model request held, out of its model's window (200k for Haiku 4.5 and the Claude 3 models, 1M for the rest). The tokens are every request's added up. The character moves, two frames 650 ms apart, only while the agent runs.
- **Done.** A finished agent drops to one line: `✓` when it answered, `✗` when it ended on an error or an interrupt, with its tokens and time. An agent you refused shows here as `refused`, while it is among the last 8 decisions; a `/config` change forgets refusals, as it forgets the queue.
- **Totals.** The second row counts the agents running and adds up the cost and tokens of every agent in the pane, and the time from the first one's start to the last one's end.

The cost is an estimate. The engine reports tokens, not money, so the pane prices each request at the model's list prices per million tokens, with cache writes at the 5-minute rate (1.25 times the input price), which is what Claude Code writes for a subagent. A subscription doesn't pay these prices. A model the price table does not know costs `≈$0.00`.

| Character | Agents | Costume |
|---|---|---|
| Explorer | `Explore` | safari hat; looks left and right as it walks |
| Developer | `general-purpose`, `claude`, any type ending in `poteto-agent` | headphones; the ear cups pulse to the beat |
| Architect | `Plan` | hard hat; the blueprint unrolls |
| Researcher | `claude-code-guide` | mortarboard; the tassel swings |
| Reviewer | any agent whose type or task description says review, audit, security or sicko, whatever its type | deerstalker; the magnifier glints |
| Clawd | any other agent | the plain crab; it just walks |

Each character is 8 cells by 3 rows. Each cell is two pixels stacked, `▀`, `▄` or `█` in the pixels' colours, so the terminal and the desktop paint the same picture.

## Steps and the plan

The delegator registers two tools the model can call.

- **`step`** (`done`, `total`, `note`) is for an agent to report its own progress: its plan's total, then each step as it finishes. The pane shows it as `3/6` and the note. A call from outside any agent the pane tracks is answered `ignored`. With **Ask agents to report their steps** on, each agent's task ends with one line asking it to call `step` when it starts and after each step. The task the pane shows for an agent waiting for you includes that line, so you approve what launches. A task that already names the tool, a workflow agent's and a resumed agent's get no line.
- **`progress`** (`title`, `phase`, `total`, `done`, `tasks`, `finished`) is for a session that hands a plan out to agents. The pane shows the plan's title and phase, and lists each planned task no agent has taken yet under PLANNED, matched to agents by the task's title and the agent's description. `after #5` says the task waits on agent #5, the newest to take that task; `after 2` says it waits on planned task 2. A plan under a new title starts over, keeping only the agents still running. Only the main session can report a plan; a call from an agent is ignored.

While a plan is reported and not finished, a row above the prompt shows it: its title and phase, how many tasks are accepted, and `● 3 agents ▸`, which opens the pane. The row sits over whatever other plugins draw there, so user-hud's band still shows.

## What it reaches

`claude plugin validate .` lists it: `$.ui.ask` (the dialogs), `tool.call` of AskUserQuestion (its own dialogs only: the line under each option, and whether a dialog closed by itself), `$.tool.register` (`step` and `progress`), `$.config.set` (its own row), `$.ui.open` (its pane), `$.state` (the agents it tracks), `$.clock` (the wait for another agent's answer, and the characters' frames). It reads every `agent.spawn` and changes only the task and model you chose, and adds the line asking for steps. It reads the token counts of each agent's model requests (`turn.step`) and each agent's end (`turn.complete`). Nothing is sent anywhere and no files are written.

## Settings

| `/config` row | Default | |
|---|---|---|
| Approve subagents before launch | on | the gate itself |
| Suggest a model by task complexity | on | the model shown when Claude names none |
| Animate the characters | on | the running agents' characters move; off, they stand still and no timer runs |
| Ask agents to report their steps | on | the line added to each agent's task asking it to call `step` |

## Credits

The agent tracking, the `step` and `progress` tools, the price table and the row above the prompt are ported from [savvy-progress](https://github.com/johnnyvizz/claude-kit/tree/main/plugins/savvy-progress) by johnnyvizz, under the MIT license.
