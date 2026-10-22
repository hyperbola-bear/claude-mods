# claude-mods

Polar's Claude Code mods, as one plugin marketplace (`polar-mods`) with four plugins:

| Plugin | What it does |
| --- | --- |
| [user-hud](plugins/user-hud) | A control panel above the prompt, laid out as cards in one to three columns by width, in seven modules you turn on or off: your other Claude Code sessions (which need you, which are working, which are done), how full the context is as a ten-cell battery and where your tokens go, model and effort pickers in three styles, prompt-cache countdown with a 2-minute keep-warm alert, guesses Claude made for you to mark right or wrong, Write / Read handoff buttons, and next steps: after each reply, follow-up prompts one key puts in the prompt box. |
| [code-reference](plugins/code-reference) | Replies that point at code. Ask with `/code-reference` (a question, or a PR to review; only the command triggers it) and the reply comes back as prose linked to the code, a row of numbered boxes under each section; a click shows that code in a pane beside it, read from disk. Drawn the same in the terminal and the desktop app. Was pr-review-ui. |
| [ask](plugins/ask) | A side chat in a pane that forks the main chat to answer, so it knows the whole session; nothing goes back unless you send it (`s`). It scrolls, and draws Mermaid diagrams: box art in the terminal, SVG in the desktop app. `/ask`, `/draw`. |
| [delegator](plugins/delegator) | Every subagent Claude starts waits for your approval: approve, refuse, approve all for the turn, change its model (suggested by the task's complexity: Haiku for lookups, Sonnet for building, Opus for design) or add a note to its task. The pane then follows each agent as it runs, drawn as a pixel character for its role, with its context battery, tokens, estimated cost, time and the steps it reports. `/delegator on`, `/delegator off`. |

user-hud draws on the band above the prompt; code-reference, ask and delegator draw in panes of their own, so they work together or alone. delegator adds one row above the prompt only while an orchestrating session reports a plan, and stacks it with user-hud's band.

## Get started

You need Claude Code 2.1.287 or later, and Python 3.9 or later (macOS includes it).

1. Run the `mods` script in a terminal:

   ```
   python3 <(curl -fsSL https://raw.githubusercontent.com/hyperbola-bear/claude-mods/main/mods)
   ```

2. Tick the mods you want with the arrow keys and space, then press Enter.
3. If you ticked user-hud, pick its modules: cache, pickers, tokens, handoff, next steps, sessions, guesses.
4. Check the list of changes and press Enter to go ahead.
5. Start a new Claude Code session. The mods are loaded.

To get new versions later, run it again with `--update`:

```
python3 ~/.claude/plugins/marketplaces/polar-mods/mods --update
```

Run the same script without `--update` to add or remove mods, or to change user-hud's modules. The next section covers its options.

## Install and update

`mods` installs, updates and removes them from one checklist. In a terminal:

```
python3 <(curl -fsSL https://raw.githubusercontent.com/hyperbola-bear/claude-mods/main/mods)
```

It adds the `polar-mods` marketplace if you have not yet, refreshes it, and lists every mod with what you have and what is new. Tick the ones you want (space, arrows, Enter): it installs the new ones, updates the ones you have, and removes the ones you untick. For a mod with modules, user-hud's cache, pickers, tokens, handoff, next steps, sessions and guesses, it then asks which to turn on. If you keep delegator and have savvy-progress on, it offers to disable savvy-progress, since delegator now tracks the same agents (it stays installed; `claude plugin enable savvy-progress@claude-kit` brings it back). It shows what it will do and asks before it does it. Then start a new Claude Code session. Mods need Claude Code 2.1.287 or later.

Once the marketplace is added, the script is also on disk:

```
python3 ~/.claude/plugins/marketplaces/polar-mods/mods
```

- `--update` updates every mod you have, with no questions.
- `--list` shows each mod's state and changes nothing.
- `--dry-run` shows the `claude plugin` commands instead of running them.

Two plugins were renamed: user-hud was user-hd before 1.2.0, and code-reference was pr-review-ui before 2.0.0. `mods` lists an old install as renamed, ticks its replacement, and removes the old one.

By hand, the same is `claude plugin marketplace add hyperbola-bear/claude-mods`, then `claude plugin install <mod>@polar-mods` for each one. To update, run `claude plugin marketplace update polar-mods`, then `claude plugin update <mod>@polar-mods`.

## Develop

Each plugin has its own tests:

```
claude plugin validate plugins/user-hud && claude plugin test plugins/user-hud
claude plugin validate plugins/code-reference && claude plugin test plugins/code-reference
claude plugin validate plugins/ask && claude plugin test plugins/ask
claude plugin validate plugins/delegator && claude plugin test plugins/delegator
```

Tests don't show what a person sees. To drive a mod in a real Claude Code, in the terminal through tmux and in the desktop app, and check that both draw the same rows at every width, use the `verify` skill in [.claude/skills/verify](.claude/skills/verify/SKILL.md). Its `use-source.sh` points your installed polar-mods at this checkout, so edits reach a session through `/reload-plugins`, and `use-source.sh --github` switches back.
