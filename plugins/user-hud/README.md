<img src="assets/logo.png" alt="user-hud logo: an orange diamond inside a countdown ring" width="96" align="right">

# user-hud

A control panel tucked into the bottom-right corner, above the Claude Code prompt: your other sessions and which of them need you, how full the context is and where the tokens go, model and effort pickers, prompt-cache countdown, the guesses Claude acts on for you to check, next steps after each reply, handoff buttons, and the settings you toggle most.

## Modules

The panel is seven modules, each on by default:

| Module | What it is |
| --- | --- |
| `sessions` | your other sessions: which need you, which are working, which finished lately; the Sessions pane |
| `tokens` | how full the context is and where the tokens go: the context battery, the CONTEXT card and the Tokens pane; `/tokens` |
| `pickers` | the model and effort pickers; `/hud-styles` |
| `cache` | the cache countdown, Keep warm, the expiry alerts and the overage warning; `/cache`, `/keepwarm` |
| `assume` | the guesses Claude acts on, for you to mark right or wrong |
| `next` | next steps: follow-up prompts after each reply, one key to put one in the prompt box |
| `handoff` | Write handoff and Read handoff; `/read-handoff` |

Turn a module off and it leaves the panel and the closed row, its commands are not registered, and none of its work runs: with `cache` off nothing counts down, alerts or pings; with `tokens` off nothing is counted; with `next` off no reply asks for suggestions; with `sessions` off no session file is read; and with `assume` off Claude is not given the tool. Turn every module off and the band draws nothing.

- `/hud modules` lists them, and `/hud <module> on|off` switches one (`/hud tokens off`).
- `/config` has the same switches, as **Module: cache**, **Module: guesses** and so on.
- The [`mods` script](../../README.md#install-and-update) asks which modules to turn on when it installs or updates user-hud.

## The corner

Closed, it is one row at the right edge. As the row narrows, the least needed piece shortens, then goes, until it fits:

```
● 1 needs you  ● 52:10  context ▕███▍      ▏ 34%  ● 2 working · ✓ 3 done  ? 4 to check  ✦3   ▐▛▜▌ user-hud ▴
                                                  ● 1 needs you  ● 52:10  ▕███▍      ▏ 34%   ▐▛▜▌ user-hud ▴
                                                                                        ●1   ▐▛▜▌ user-hud ▴
                                                                                                        ▐▛▜▌
```

- The pieces, left to right: who needs you, the cache countdown, the context battery, what your other sessions are doing, guesses to check, next steps waiting, the model and effort (`Opus 5.5 · XHigh`), and the session's token total (`1.2M tokens`). The token total goes first, then the model and effort, next steps, the guesses, the other sessions, the context and the countdown, each shortening before it goes (`Opus · XH`, `✦3`, `?4`, `●2 ✓3`). Who needs you goes last, and then the tab keeps only its face.
- The tab is Clawd's face, `▐▛▜▌`, in cream on Claude's orange. While another session needs you, its eyes (the two empty quarters) turn yellow, so the corner tells you even with nothing else on show.
- The countdown's dot is a pie of the cache life left: `●` while nearly all of it is, then `◕`, `◑`, `◔`, and `○` near the end and once cold. Its colour follows the cache: green while warm, yellow with 2 minutes or less left, red once cold.
- The context is a battery: ten cells that fill left to right as the context window does, green up to half, yellow up to three quarters, red past that, then the percentage (the figure the status line reads). Short of room, it drops the word `context`, then the cells, leaving `34%`.
- The model is drawn in its colour and the effort in its own, letter by letter (the whole rainbow for Ultracode).
- When 2 minutes or less are left, **Keep warm** comes out next to the tab, so it is one press away with the panel closed. On overage, **⚠ overage** and **New chat** come out beside the countdown.
- Click **● 1 needs you** or the session counts to open the Sessions pane, **? 4 to check** to open the panel with the guesses first, and **✦ 3 next** to open the panel.

Click the tab (or run `/hud`) and the panel opens above it, as cards. Open or closed is remembered across sessions.

```
── S E S S I O N S ────────────────── e: expand ─  ── C O N T E X T ─────────────────── t: details ─
● 1 needs you  ● 2 working  ✓ 3 done     1 asleep  ▕███▍      ▏ 34%                          of 200k
● Rename the billing flags                     2m  ████████████████ 1.2M used
● Fix the flaky checkout test                  1m
● Draft the release notes                      3m  ── M O D E L   ·   E F F O R T ──────────────────
                                                   MODEL   ▄ Haiku 4.5 ▄▄ Sonnet 5.5 ███ Opus 5.5
── C A C H E ────────────────────────────────────          ▄▄▄▄ Fable 5.1
● cache 52:10 ▰▰▰▰▰▰▰▰▰▱                           EFFORT  ▄ Low ▄▄ Medium ▄▄▄ High ████ XHigh
182k cached · hit 94% · 1h          w: Keep warm           ▄▄▄▄▄ Max ▄▄▄▄▄▄▄ Ultracode

── C H E C K   M Y   G U E S S E S ──── +1 more ─  ── N E X T   S T E P S ──────────────────────────
✓ ✗  The tests run with npm test, from the repo …  ✦ 1: Run the tests
✓ ✗  "Done" means merged, not only approved        ✦ 2: Commit this and open a PR
✓ ✗  Keep the old endpoint until its callers move  ✦ 3: Add a test for the empty case

── H A N D O F F ────────────────────────────────
✦ h: Write   ◆ r: Read   newest · 2h ago
⚙ s: Settings                                                                       ▐▛▜▌ user-hud ▾
```

- The cards sit in one, two or three columns, as many as fit at 36 cells or more each, across at most 132 cells, two cells apart. Each card goes into the shortest column, a blank row under it. They come in this order, each only while its module is on: sessions, context, model and effort, cache, guesses, next steps, handoff. The guesses and next steps cards show only when they hold something.
- When the band is short (the desktop shows 12 rows), every card folds to one row, all but a card brought to the front, which stays in full where it fits:

```
SESSIONS                        ●1 ●2 ✓3 1 asleep  CONTEXT ▕███▍      ▏ 34%                     1.2M

MODEL Opus 5.5 · XHigh                    m: pick  ● 52:10 ▰▰▰▰▰▰▰▰▰▱                  w: Keep warm

? 4 to check                            a: review  ✦ 1: Run the tests                            2 3

✦ h: Write   ◆ r: Read   newest · 2h ago
⚙ s: Settings                                                                       ▐▛▜▌ user-hud ▾
```

- When even the folded cards need more rows than there are, the last ones go and **+N more** in the bottom bar says how many; press it and they come first.
- **⚙ s: Settings** turns the panel to the settings, and **⚙ s: Back** turns it back to the cards. When the rows are too few for them, the settings fold onto one line of pills.

```
── S E T T I N G S ─────────────────────────────────────────────────────
○ Auto keep-warm   ping 30s before expiry, ~18k cost each, ≤3     ○ Off
● Alert sound      Glass at the warning                            ● On
● Mac alert        Keep warm button, closes in 7s                  ● On
◇ Alert at         time left when the alert fires                  2:00
◇ Picker style     Rail, Ladder or Meter                           Rail
⚙ s: Back                                               ▐▛▜▌ user-hud ▾
```

- **Model** runs `/model haiku|sonnet|opus|fable`. Switching models starts the prompt cache over, and the countdown says so.
- **Effort** runs `/effort <level>`. The highlight follows the effort your requests actually carry, so a level the model caps shows the one in use. It shows once the first request has gone out.
- **Ultracode** runs `/effort ultracode on`: the effort level stays and Claude may run multi-agent workflows. Picking a level turns it off again, as `/effort <level>` does. It needs dynamic workflows on (see `/config`); where they are off the picker stays on the level and a toast says why. `/effort` typed at the prompt moves the picker too.
- **Settings** write the same rows as `/config`, so the two never disagree. A row your organization's policy owns stays put, with a toast saying why. The other settings (show the band, automatic pings per idle stretch, handoff note location, the modules) stay in `/config`.
- The whole band, the closed row and the open panel, is one grid of cells the plugin lays out itself and paints in a `Client` region, and so are its panes: no native buttons and no text in the app's own font, so the terminal and Claude Desktop draw the same cells (the tests require the two drawings identical). Click any button in it; or click into it, then use its hotkeys, or the arrow keys and Return. VS Code and mobile, which draw no `Client`, get the same rows as text with plain buttons beneath.
- When the band is narrow, for example beside a pane docked in the terminal, the cards stack in one column, the section titles lose their letter spacing, and the closed row sheds its pieces as above. A row that still does not fit is cut on the right, ending in `…`; the band never runs off its left edge.
- To put the panel away, use the tab. The `[-]` (× on the desktop) at the band's right end is Claude Code's own control for collapsing the whole band; a plugin cannot remove it.

## Model and effort pickers

The model colours run from blue, orange's complement, to orange as the models get more capable (Haiku, Sonnet, Opus, Fable). The effort colours run from one grey at Low to the full rainbow at Ultracode: each step up spans more of the spectrum, more saturated. Each step sits in its own segment with a gap between, the bar between the levels.

Three styles; **Picker style** in the settings (or in `/config`) switches between them, and `/hud-styles` opens a pane that draws all three side by side with your model and effort, a **Use** button under each:

- **Rail** (the default): the labels over a segmented bar, one segment per step. The chosen step's segment is solid; the others are a thin line in their own colour, so the whole ramp is always on show. Two rows a picker.
- **Ladder**: one row. Before each label a strip that grows a cell per step up, in that step's colours; the chosen one is full blocks, the others half blocks. The most compact.
- **Meter**: bars that rise step by step over the labels, like a signal meter. Every step up to the chosen one is lit in its colours; the ones past it are dim. Two rows a picker.

The pickers are part of the band's grid: click an option to pick it, or move to it with the arrow keys and press Return. A two-row style shows the MODEL and EFFORT names beside the steps in a card 67 cells wide or more. In a narrower card the names go first, then the labels shorten: `Sonnet 5.5` to `Sonnet`, `Ultracode` to `Ultra`, `Medium` to `Med`. Under 27 cells the pickers fall back to the Ladder, which wraps. Folded, the card shows the model and effort as text, and `m` opens `/hud-styles`.

## Sessions

The **SESSIONS** card counts your other Claude Code sessions on this machine, the terminal's and the desktop app's alike, and lists the ones that matter first: the ones that need you, then the ones working, then the ones done.

```
── S E S S I O N S ────────────────── e: expand ─
● 1 needs you  ● 2 working  ✓ 3 done     1 asleep
● Rename the billing flags                     2m
● Fix the flaky checkout test                  1m
● Draft the release notes                      3m
```

- A yellow `●` needs you: Claude Code marks the session as waiting on you. A blue `●` is working through a turn. A green `✓` finished in the last 8 hours. Idle for longer than that, a session is asleep, and only counted.
- Each row is the session's title, then where it runs (`cli` or `app`, once the card is 52 cells wide) and how long ago its state changed. The title is the name you gave the session, else its custom title, else the title Claude gave it, else its name, cut at 30 characters.
- This session is not counted; the Sessions pane shows it apart.
- **e: expand** (`e`) opens the Sessions pane, a grid of cells like the band. `z` shows or hides the sessions asleep, and `e` closes it.

```
── S E S S I O N S ───────────────────────────────── 8 live · e: close ─
NEEDS YOU · 1
● Rename the billing flags                                       cli  2m
WORKING · 2
● Fix the flaky checkout test                                    cli  1m
● Draft the release notes                                        app  3m
DONE · 3 in the last 8h
✓ Bump the dependencies                                          cli 12m
✓ Move the cron jobs                                             app 41m
✓ Onboarding doc                                                 cli  1h
ASLEEP · 1 idle over 8h                                          z: hide
· Spike: a GraphQL gateway                                       cli  1d
THIS SESSION · 1
● this one                                                       app now
```

- Every 5 seconds it reads the status files Claude Code keeps in `~/.claude/sessions/` (`$CLAUDE_CONFIG_DIR/sessions/` where that is set), and one `ps` says which of their processes still run; a session whose process is gone is dropped. The titles come from the transcripts, read by one `sh` at most once a minute, and only the title lines of each.
- `/hud sessions off` stops all of it: no file is read and no timer runs.

## Tokens

The **CONTEXT** card shows how full the context window is now, as the battery (`▕███▍      ▏ 34%`, with the window's size, `of 200k`), and under it one stacked bar of where this session's tokens went, with the total. The closed row shows the battery too. **Details** (`t`), or `/tokens`, opens the Tokens pane, a grid of cells like the band (**Refresh** `r`, **Reset** `x`): the API's own totals (cache read, cache write, new input, output, and the cost where Claude Code keeps one), then each group with its share, what it used, what it holds in the context now, and its calls. Press a group (▸) to open it (▾): its sub-items, most used first, each with the tokens it used, its share of the group, and what it holds in the context now.

```
── C O N T E X T ─────────────────── t: details ─
▕███▍      ▏ 34%                          of 200k
████████████████ 1.2M used
```

```
▾ ■ Skills & plugins    6% █░░░░░░░░░░░ 1.2M used · 9k in context · 14 calls
    user-hud                   412k   34%
    ask                        310k   26%
    pstack:poteto-mode         180k   15%   6k in context
```

A sub-item's tokens are counted the way its group's are: each request's input is split by what each sub-item held when it went out, so the sub-items add up to the group. Files are listed by file, Shell by command, Web by site, MCP by server (its schemas included), Skills & plugins by skill, command, hook or plugin (a plugin's own model calls under its name), Subagents by type, Chat by who wrote it, and System & memory by the context breakdown's rows (the system prompt, the built-in tools, memory files) and reminders. Past 24 in a group, the smallest fold into `other`; what a group held before counting began is `unattributed`.

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

- The pie in front of the time empties as the cache's life runs down (`●`, `◕`, `◑`, `◔`, `○`). Green while warm, yellow with 2 minutes or less left, red once cold (the next prompt re-writes the whole prefix).
- With 2 minutes left and Claude idle, it alerts once: a toast, the Glass sound, and a macOS alert with the user-hud logo and its own **Keep warm** button (Return presses it). The alert closes by itself after 7 seconds; set **macOS alert stays (seconds)** in `/config` to change that (3 to 60).
- **Keep warm** (`w`, or `/keepwarm`) sends a one-line request that reads the cached prefix, which resets the cache timer, and adds nothing to the conversation. Every request re-reads the whole cached conversation (typing "hi" does too), so a ping reads all of it: with 182k cached that is 182k cache-read tokens, billed at a tenth of the input price, about 18k input tokens' worth, plus a few output tokens. Once something is cached, the **Auto keep-warm** row shows that cost (`~18k cost each, ≤3`: up to 3 pings while you are idle), so you see it before turning it on; `/cache` gives the same with the total for one idle stretch. If the cache expires instead, your next prompt writes it again at 1.25× (5m) to 2× (1h) the input price.
- The countdown follows the lifetime Claude Code gives the cache: 1 hour. Claude Code's `promptCacheTtl` setting decides it, and `"promptCacheTtl": "1h"` in `~/.claude/settings.json` keeps it at an hour for every session, API-key sessions and overage included. 1-hour cache writes cost more than 5-minute ones (cache reads cost the same). Unset, a subscription gets 1 hour and drops to 5 minutes while on overage, and the countdown follows.
- **Overage:** when a plan window (5-hour or weekly) is past its limit, the subscription runs on overage. **⚠ overage** shows in the cache card and on the closed row, with a **New chat** button: every turn re-sends the whole chat at extra-usage rates, so a fresh one costs less per turn. **New chat** runs `/clear`; the old chat stays in `/resume`.
- `/cache` prints time left, size, hit rate, the lifetime and why, and the overage state.
- Optional: **Keep the cache warm automatically** pings 30 seconds before expiry, up to 3 times between two of your prompts.

## Guesses

user-hud gives Claude an `assumption` tool, and a line in the system prompt saying it is there. Whenever Claude picks one reading of an ambiguous request, fills in a detail you did not give, or relies on a fact it has not checked, it calls the tool with one short line per guess, then carries on without waiting. The guesses show in the panel under **CHECK MY GUESSES**:

```
── C H E C K   M Y   G U E S S E S ──── +1 more ─
✓ ✗  The tests run with npm test, from the repo …
✓ ✗  "Done" means merged, not only approved
✓ ✗  Keep the old endpoint until its callers move
```

- `✓` marks a guess right, and it leaves the card.
- `✗` marks it wrong and puts `Not quite: "<guess>". ` in the prompt box, for you to finish with what is right and send. If the box already holds a draft, the draft stays and a toast asks you to send or clear it first.
- Up to five guesses a call, 140 characters each. The card shows three; `+N more` in its title counts the rest.
- With the panel closed, **? 4 to check** beside the tab says they are waiting. Click it, or **a: review** in the folded card, to open the panel with the guesses first. On a short band they then stay in full while the other cards fold, so you can mark them; where even that does not fit (one column, 12 rows), the card stays folded.
- Your next prompt clears them, marked or not.
- `/hud assume off` takes the tool and the system prompt line away.

## Next steps

After each reply, up to three follow-up prompts show in the panel, under **NEXT STEPS**:

```
── N E X T   S T E P S ──────────────────────────
✦ 1: Run the tests
✦ 2: Commit this and open a PR
✦ 3: Add a test for the empty case
```

- Press `1`, `2` or `3` (once you have clicked into the band), or click one, and it goes in the prompt box as your draft, replacing what is there. Edit it or press Enter.
- With the panel closed, **✦ 3 next** beside the tab says they are waiting; click it to open the panel.
- They come from one short Haiku call on your last prompt (its first 2,000 characters) and the reply (its last 6,000), not the whole conversation, so each costs a few thousand Haiku tokens. The Tokens pane counts them under Skills & plugins, as user-hud.
- A new prompt clears them. A stopped turn asks for none. If the call fails, the panel says why in their place.
- Folded, the card shows the first, with `2` and `3` beside it.
- `/hud next off` turns them off.

## Handoff

- **Write handoff** (`h`) runs your `/handoff` command. Without one, it asks Claude to write a note to `.claude/handoffs/<date>-<time>.md`.
- **Read handoff** (`r`, or `/read-handoff`) opens the newest note with **Continue from this** (`c`), **Older** (`o`), **Newer** (`n`) and **Rescan** (`r`). The note is drawn as text in the pane's grid of cells: headings bold, code dim, list items wrapped under their text.
- Notes are found in `HANDOFF.md`, `.claude/`, `.claude/handoffs/`, `handoffs/` and `docs/`. If yours live elsewhere, set **Handoff note location** in `/config`.

Band hotkeys work once you have clicked into the band: `e` the Sessions pane, `t` the Tokens pane, `m` the picker styles, `w` Keep warm, `a` the guesses, `h` and `r` the handoff, `1` to `3` next steps, and `s` the settings. Each works while its button is on show, so with the panel closed it is `e`, `a`, and `w` while Keep warm is out; `/handoff`, `/read-handoff` and `/tokens` still work from the prompt.

## What it can reach

`claude plugin validate .` lists it: `$.model.fork` (keep-warm pings), `$.model.complete` (next steps, on Haiku), `$.process.run` (osascript and afplay for the alert; `ps` for which sessions still run and `sh` for their titles), file reads (handoff notes, the alert's logo, the session status files), `$.store` (whether the panel is open), `$.settings.read` (your effort level and `promptCacheTtl`), `$.env` (CLAUDE_CODE_PROMPT_CACHE_TTL; HOME and CLAUDE_CONFIG_DIR, to find the session files), `$.session.usage` (the plan windows, for overage; the context breakdown and the cost, for tokens), `$.session.id` (to tell this session from the others), `$.agent.list` (a subagent's type), `$.config.set` (its own rows, from the panel's toggles), `$.tool.register` and a `prompt.compose` section (the `assumption` tool and the line saying it is there), and command run (`/model`, `/effort`, `/handoff`, `/clear`) and prompt submit on button presses, and prompt fill when you pick a next step or press `✗` on a guess (after `$.prompt.read` checks the box is empty). To count tokens it reads every row the conversation keeps (`session.append`), each model request's usage (`turn.step`) and other plugins' model calls (`model.fork`, `model.complete`), and changes none of them. The tally and the guesses stay in the session; nothing is sent anywhere. It writes no files.
