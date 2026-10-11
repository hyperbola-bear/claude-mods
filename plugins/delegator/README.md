# delegator

Every subagent Claude starts waits for your approval first. You see the task, the agent type and the model it would run on, and you approve it, refuse it, change its model, add a note to its task, or approve every agent for the rest of the turn.

```
┌ Delegator ────────────────────────────────────────────────────────────┐
│ DELEGATOR ● on                                              Turn off  │
│ ── P E N D I N G ──────────────────────────────────────────────────── │
│ ▸ #1 general-purpose · implement retry · Sonnet                       │
│   #2 Explore · inspect cache tests · Haiku                            │
│ ── T A S K   # 1 ──────────────────────────────────────────────────── │
│ Add a retry with backoff to fetchPlan in api.ts.                      │
│ ── R E C E N T ────────────────────────────────────────────────────── │
│ ✓ #3 Plan · plan the rollout · approved on Opus 5.5                   │
│ ✗ #4 general-purpose · rewrite the tests · refused                    │
└───────────────────────────────────────────────────────────────────────┘

 Launch #1 general-purpose "implement retry" on Sonnet (suggested: building)?
 ❯ 1. Approve                 Launch it as shown (full task in the Delegator pane). Or type below to add a note to its task.
   2. Approve all this turn   Launch this and every agent until this turn ends, unasked.
   3. Change model            Pick Haiku, Sonnet, Opus or Fable, then decide.
   4. Refuse                  Do not launch it; the caller is told you refused.
   5. Type something.
```

## Use

| | |
|---|---|
| **Approve** | launch it with the task and model shown |
| **Approve all this turn** | launch it, and every agent after it, until the main turn ends or you send another prompt |
| **Change model** | Haiku, Sonnet, Opus or Fable (or type `default` for the agent's own, or a full model id), then the question comes back |
| **Refuse** | nothing starts; Claude is told you refused and not to start it again unless you ask |
| type an answer | it's added to the agent's task as a note, under "Notes from the person who approved this agent", and the question comes back |
| `/delegator` | open the pane and say whether the gate is on |
| `/delegator off`, `/delegator on` | turn the gate off or on; so do the pane's **Turn off** (`o`) and `/config` |

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

## What it reaches

`claude plugin validate .` lists it: `$.ui.ask` (the dialogs), `tool.call` of AskUserQuestion (its own dialogs only: the line under each option, and whether a dialog closed by itself), `$.config.set` (its own row), `$.ui.open` (its pane), `$.clock` (the wait for another agent's answer). It reads every `agent.spawn` and changes only the task and model you chose. Nothing is sent anywhere and no files are written.

## Settings

| `/config` row | Default | |
|---|---|---|
| Approve subagents before launch | on | the gate itself |
| Suggest a model by task complexity | on | the model shown when Claude names none |
