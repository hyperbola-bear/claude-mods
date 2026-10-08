<img src="assets/logo.png" alt="user-hud logo: an orange diamond inside a countdown ring" width="96" align="right">

# user-hud

A control panel tucked into the bottom-right corner, above the Claude Code prompt: prompt-cache countdown, model and effort pickers, the settings you toggle most, and handoff buttons.

## The corner

Closed, it is one row at the right edge:

```
                                  ◆ 52:10   Sonnet 5.5 · XHigh   ◆ user-hud ▴
```

Click the **◆ user-hud** tab (or run `/hud`) and the panel opens above it. Open or closed is remembered across sessions.

```
MODEL    Haiku 4.5 [Sonnet 5.5] Opus 5.5  Fable 5.1
EFFORT   Low  Medium  High [XHigh] Max
── C A C H E ───────────────────────────────────────────────
◆ cache 52:10 ▰▰▰▰▰▰▰▰▰▱ 182k cached · hit 94% · 1h [ Keep warm ]
── S E T T I N G S ─────────────────────────────────────────
● Auto keep-warm   ping 30s before expiry, up to 3       ○ Off
● Alert sound      Glass at the warning                  ● On
● Mac alert        Keep warm button, closes in 7s        ● On
◇ Alert at         time left when the alert fires         2:00
── H A N D O F F ───────────────────────────────────────────
✦ h: Write handoff   ◆ r: Read handoff   newest · 2h ago
─────────────────────────────────────────────── user-hud ─
                                                ◆ user-hud ▾
```

- **Model** runs `/model haiku|sonnet|opus|fable`. Switching models starts the prompt cache over, and the countdown says so.
- **Effort** runs `/effort <level>`. The highlight follows the effort your requests actually carry, so a level the model caps shows the one in use.
- **Settings** write the same rows as `/config`, so the two never disagree. A row your organization's policy owns stays put, with a toast saying why. The other settings (show the band, automatic pings per idle stretch, handoff note location) stay in `/config`.
- When 2 minutes or less are left, **Keep warm** comes out next to the tab, so it is one press away with the panel closed.
- In Claude Desktop the panel uses the app's own buttons: the model, effort and settings in use are the filled ones. The desktop draws it in its own font (Anthropic Sans); a plugin cannot change that.
- When the band is short (the desktop shows 12 rows), the panel drops the CACHE and HANDOFF dividers and the bottom line so it fits without scrolling. In a short terminal it can still scroll.
- To put the panel away, use the tab. The `[-]` (× on the desktop) at the band's right end is Claude Code's own control for collapsing the whole band; a plugin cannot remove it.

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
- **Read handoff** (`r`, or `/read-handoff`) opens the newest note with **Continue from this** (`c`), **Older** and **Newer**.
- Notes are found in `HANDOFF.md`, `.claude/`, `.claude/handoffs/`, `handoffs/` and `docs/`. If yours live elsewhere, set **Handoff note location** in `/config`.

Band hotkeys need the band focused: click it, or press ctrl+x then tab. `h` and `r` work while the panel is open; with it closed, `/handoff` and `/read-handoff` still do.

## What it can reach

`claude plugin validate .` lists it: `$.model.fork` (keep-warm pings), `$.process.run` (osascript, afplay), file reads (handoff notes, the alert's logo), `$.store` (whether the panel is open), `$.settings.read` (your effort level and `promptCacheTtl`), `$.env` (CLAUDE_CODE_PROMPT_CACHE_TTL), `$.session.usage` (the plan windows, for overage), `$.config.set` (its own rows, from the panel's toggles), and command run (`/model`, `/effort`, `/handoff`, `/clear`) and prompt submit on button presses. It writes no files.
