# user-hd

A band above the Claude Code prompt with a prompt-cache countdown and handoff buttons.

## Prompt cache countdown

```
◆ cache 3:12   182k cached · hit 94% · 5m   [ Keep warm ]   [ Handoff ] [ Read handoff ]
```

- Green while warm, yellow with 2 minutes or less left, red once cold (the next prompt re-writes the whole prefix).
- With 2 minutes left and Claude idle, it alerts once: a toast, a macOS notification banner and the Glass sound.
- **Keep warm** (`w`, or `/keepwarm`) sends a one-line request that reads the cached prefix, which resets the cache timer, and adds nothing to the conversation. It costs one cache read of the prefix plus a few output tokens.
- `/cache` prints time left, size, hit rate and lifetime. The lifetime starts at 5 minutes and switches to 1 hour, remembered, the first time a cache hit arrives after more than 5 idle minutes. Set it yourself in `/config`.
- Optional: **Keep the cache warm automatically** pings 30 seconds before expiry, up to 3 times between two of your prompts.

## Handoff

- **Handoff** (`h`) runs your `/handoff` command. Without one, it asks Claude to write a note to `.claude/handoffs/<date>-<time>.md`.
- **Read handoff** (`r`, or `/read-handoff`) opens the newest note with **Continue from this** (`c`), **Older** and **Newer**.
- Notes are found in `HANDOFF.md`, `.claude/`, `.claude/handoffs/`, `handoffs/` and `docs/`. If yours live elsewhere, set **Handoff note location** in `/config`.

Band hotkeys need the band focused: click it, or press ctrl+x then tab.

## What it can reach

`claude plugin validate .` lists it: `$.model.fork` (keep-warm pings), `$.process.run` (osascript, afplay), file reads (handoff notes), `$.store` (the learned cache lifetime), and command run and prompt submit on button presses. It writes no files.
