<img src="assets/logo.png" alt="user-hud logo: an orange diamond inside a countdown ring" width="96" align="right">

# user-hud

A control panel tucked into the bottom-right corner, above the Claude Code prompt: where your tokens go, model and effort pickers, prompt-cache countdown, the settings you toggle most, and handoff buttons.

## The corner

Closed, it is one row at the right edge:

```
                     ◆ 52:10   1.2M tokens   Sonnet 5.5 · XHigh   ◆ user-hud ▴
```

The model is drawn in its colour and the effort in its own, letter by letter (the whole rainbow for Ultracode).

Click the **◆ user-hud** tab (or run `/hud`) and the panel opens above it. Open or closed is remembered across sessions.

```
MODEL       Haiku 4.5      Sonnet 5.5       Opus 5.5       Fable 5.1
         ▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔ ███████████████ ▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔ ▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔
EFFORT     Low     Medium    High     XHigh     Max    Ultracode
         ▔▔▔▔▔▔▔▔▔ ▔▔▔▔▔▔▔▔▔ ▔▔▔▔▔▔▔▔▔ █████████ ▔▔▔▔▔▔▔▔▔ ▔▔▔▔▔▔▔▔▔
TOKENS  ████████████████ 1.2M · Files 38% · System & memory 21%   t: Details
── C A C H E ───────────────────────────────────────────────────────────
◆ cache 52:10 ▰▰▰▰▰▰▰▰▰▱ 182k cached · hit 94% · 1h          [ Keep warm ]
── S E T T I N G S ─────────────────────────────────────────────────────
● Auto keep-warm   ping 30s before expiry, up to 3                 ○ Off
● Alert sound      Glass at the warning                            ● On
● Mac alert        Keep warm button, closes in 7s                  ● On
◇ Alert at         time left when the alert fires                   2:00
◇ Picker style     Rail, Ladder or Meter                            Rail
── H A N D O F F ───────────────────────────────────────────────────────
✦ h: Write handoff   ◆ r: Read handoff   newest · 2h ago
─────────────────────────────────────────────────────────── user-hud ─
                                                            ◆ user-hud ▾
```

- **Model** runs `/model haiku|sonnet|opus|fable`. Switching models starts the prompt cache over, and the countdown says so.
- **Effort** runs `/effort <level>`. The highlight follows the effort your requests actually carry, so a level the model caps shows the one in use. It shows once the first request has gone out.
- **Ultracode** runs `/effort ultracode on`: the effort level stays and Claude may run multi-agent workflows. Picking a level turns it off again, as `/effort <level>` does. It needs dynamic workflows on (see `/config`); where they are off the picker stays on the level and a toast says why. `/effort` typed at the prompt moves the picker too.
- **Settings** write the same rows as `/config`, so the two never disagree. A row your organization's policy owns stays put, with a toast saying why. The other settings (show the band, automatic pings per idle stretch, handoff note location) stay in `/config`.
- When 2 minutes or less are left, **Keep warm** comes out next to the tab, so it is one press away with the panel closed.
- The whole band, the closed row and the open panel, is one grid of cells the plugin lays out itself and paints in a `Client` region: no native buttons and no text in the app's own font, so the terminal and Claude Desktop draw the same cells (the tests require the two drawings identical). Click any button in it; or click into it, then use its hotkeys, or the arrow keys and Return. VS Code and mobile, which draw no `Client`, get the same rows as text with plain buttons beneath.
- When the band is short (the desktop shows 12 rows), the panel drops the dividers first, then folds the settings onto one line of pills, so it fits without scrolling. In a short terminal it can still scroll.
- To put the panel away, use the tab. The `[-]` (× on the desktop) at the band's right end is Claude Code's own control for collapsing the whole band; a plugin cannot remove it.

## Model and effort pickers

The model colours run from blue, orange's complement, to orange as the models get more capable (Haiku, Sonnet, Opus, Fable). The effort colours run from one grey at Low to the full rainbow at Ultracode: each step up spans more of the spectrum, more saturated. Each step sits in its own segment with a gap between, the bar between the levels.

Three styles; **Picker style** in the panel (or in `/config`) switches between them, and `/hud-styles` opens a pane that draws all three side by side with your model and effort, a **Use** button under each:

- **Rail** (the default): the labels over a segmented bar, one segment per step. The chosen step's segment is solid; the others are a thin line in their own colour, so the whole ramp is always on show. Two rows a picker.
- **Ladder**: one row. Before each label a strip that grows a cell per step up, in that step's colours; the chosen one is full blocks, the others half blocks. The most compact.
- **Meter**: bars that rise step by step over the labels, like a signal meter. Every step up to the chosen one is lit in its colours; the ones past it are dim. Two rows a picker.

The pickers are part of the band's grid: click an option to pick it, or move to it with the arrow keys and press Return. Where the panel is too narrow for a two-row style's columns, it falls back to the Ladder, which wraps.

## Tokens

The **TOKENS** row is one stacked bar of where this session's tokens went, with the total and the two largest groups. **Details** (`t`), or `/tokens`, opens the Tokens pane, a grid of cells like the band (**Refresh** `r`, **Reset** `x`): the API's own totals (cache read, cache write, new input, output, and the cost where Claude Code keeps one), then each group with its share, what it used, what it holds in the context now, its calls, and what it was made of.

| Group | What lands there |
| --- | --- |
| Files | Read, Write, Edit, NotebookEdit, Grep, Glob, and files you @-mention; by file |
| Chat | your prompts and messages in; Claude's replies out |
| MCP | MCP tool calls and their results, by server and tool; the tool schemas each request carries, by server |
| Shell | Bash, background task output and notifications; by command (`git`, `npm`, ...) |
| Skills & plugins | skills (by name), slash commands, context plugins and settings hooks inject (by plugin or hook event), and model calls plugins make beside the chat (a side chat, a keep-warm ping), by plugin |
| Web | WebFetch (by site) and WebSearch |
| Subagents | what the Agent tool is told and what it returns; what each subagent spends, by type |
| Thinking | the reasoning Claude writes before it answers |
| System & memory | the system prompt and built-in tool schemas, reminders, memory files (CLAUDE.md), compaction summaries |
| Other tools | TodoWrite, AskUserQuestion and the rest, by tool |

How it counts:

- **used** is real. Each main-thread request's input, as the API reported it, is split across the groups by what each held in the context when the request went out; its output by what was written (the reply text to Chat, each tool call's arguments to its tool's group, the rest to Thinking). A subagent's requests and a plugin's model calls count whole. So the groups add up to the API's totals.
- **in context** and the per-file, per-server and per-skill numbers are estimates, about 4 characters a token, read off every row the conversation keeps. Where those rows cannot say what the context holds (a resumed or reloaded conversation, after a compaction), it is measured from the messages the next request is built from; every 25 requests that measurement also trims the tool results and thinking the engine has dropped since.
- What each request carries before any chat (system prompt, tool and MCP schemas, skill listings) comes from Claude Code's own context breakdown, the one `/context` shows.
- Subagents are named by type. Agents no list names (a workflow's, the engine's own forks for compaction or memory) count under Subagents as *unlisted*.
- The tally covers the conversation from when user-hud loaded, and survives a plugin reload. `/clear` and `/resume` start it over. **Reset** (`x`) in the pane starts the counts over mid-chat and keeps what the context holds, so the next request is still split by what is really in it; the cost then counts from the reset.

## Prompt cache countdown

- Green while warm, yellow with 2 minutes or less left, red once cold (the next prompt re-writes the whole prefix).
- With 2 minutes left and Claude idle, it alerts once: a toast, the Glass sound, and a macOS alert with the user-hud logo and its own **Keep warm** button (Return presses it). The alert closes by itself after 7 seconds; set **macOS alert stays (seconds)** in `/config` to change that (3 to 60).
- **Keep warm** (`w`, or `/keepwarm`) sends a one-line request that reads the cached prefix, which resets the cache timer, and adds nothing to the conversation. It costs one cache read of the prefix plus a few output tokens.
- The countdown follows the lifetime Claude Code gives the cache: 1 hour. Claude Code's `promptCacheTtl` setting decides it, and `"promptCacheTtl": "1h"` in `~/.claude/settings.json` keeps it at an hour for every session, API-key sessions and overage included. 1-hour cache writes cost more than 5-minute ones (cache reads cost the same). Unset, a subscription gets 1 hour and drops to 5 minutes while on overage, and the countdown follows.
- **Overage:** when a plan window (5-hour or weekly) is past its limit, the subscription runs on overage. **⚠ overage** shows beside the cache with a **New chat** button: every turn re-sends the whole chat at extra-usage rates, so a fresh one costs less per turn. **New chat** runs `/clear`; the old chat stays in `/resume`.
- `/cache` prints time left, size, hit rate, the lifetime and why, and the overage state.
- Optional: **Keep the cache warm automatically** pings 30 seconds before expiry, up to 3 times between two of your prompts.

## Handoff

- **Write handoff** (`h`) runs your `/handoff` command. Without one, it asks Claude to write a note to `.claude/handoffs/<date>-<time>.md`.
- **Read handoff** (`r`, or `/read-handoff`) opens the newest note with **Continue from this** (`c`), **Older** (`o`), **Newer** (`n`) and **Rescan** (`r`). The note is drawn as text in the pane's grid of cells: headings bold, code dim, list items wrapped under their text.
- Notes are found in `HANDOFF.md`, `.claude/`, `.claude/handoffs/`, `handoffs/` and `docs/`. If yours live elsewhere, set **Handoff note location** in `/config`.

Band hotkeys (`w`, `h`, `r`, `t`) work once you have clicked into the band. `h`, `r` and `t` work while the panel is open; with it closed, `/handoff`, `/read-handoff` and `/tokens` still do.

## What it can reach

`claude plugin validate .` lists it: `$.model.fork` (keep-warm pings), `$.process.run` (osascript, afplay), file reads (handoff notes, the alert's logo), `$.store` (whether the panel is open), `$.settings.read` (your effort level and `promptCacheTtl`), `$.env` (CLAUDE_CODE_PROMPT_CACHE_TTL), `$.session.usage` (the plan windows, for overage; the context breakdown and the cost, for tokens), `$.agent.list` (a subagent's type), `$.config.set` (its own rows, from the panel's toggles), and command run (`/model`, `/effort`, `/handoff`, `/clear`) and prompt submit on button presses. To count tokens it reads every row the conversation keeps (`session.append`), each model request's usage (`turn.step`) and other plugins' model calls (`model.fork`, `model.complete`), and changes none of them. The tally stays in the session; nothing is sent anywhere. It writes no files.
