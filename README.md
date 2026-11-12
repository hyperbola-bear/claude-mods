# claude-mods

Four mods for [Claude Code](https://code.claude.com): a control panel above the prompt, replies that point at code, a side chat that draws, and an approval step before every subagent. Each one works in the terminal and in the Claude desktop app. Install them together or one at a time.

![Claude Code with the mods: a /code-reference reply on the left, its code in a pane on the right, the user-hud panel below](docs/images/overview.png)

| Mod | What it does |
| --- | --- |
| [user-hud](#user-hud) | A panel above the prompt: model and effort, cache timer, context use, your other sessions, follow-up prompts. |
| [code-reference](#code-reference) | Ask about code; the answer links each claim to the lines, and a click shows them in a pane. |
| [ask](#ask) | A side chat that already knows your session. It answers in a pane and can draw diagrams. |
| [delegator](#delegator) | Every subagent Claude starts waits for your OK, then shows its progress and cost as it runs. |

## Quick start: all four mods

You need Claude Code 2.1.287 or later (`claude --version`) and Python 3.9 or later (macOS includes it).

1. In a terminal (bash or zsh), run:

   ```bash
   python3 <(curl -fsSL https://raw.githubusercontent.com/hyperbola-bear/claude-mods/main/mods)
   ```

2. Press `a` to tick every mod, then press Enter.
3. Press Enter to keep all of user-hud's modules on.
4. Press Enter to install.
5. Start a new Claude Code session.

This takes about ten seconds. Lines such as `18 userConfig options not yet set` are normal: every setting starts at its default.

## Install one mod

No Python needed. Run this in a terminal, with the mod's name in place of `code-reference`:

```bash
claude plugin install code-reference --marketplace hyperbola-bear/claude-mods
```

Then start a new Claude Code session. The names are `user-hud`, `code-reference`, `ask` and `delegator`.

## Use them

| Mod | How to use it |
| --- | --- |
| user-hud | It appears above the prompt by itself. `/hud` opens or closes the panel. Click into the panel to use its keys, such as `w` to keep the cache warm and `1`–`3` for a follow-up prompt. |
| code-reference | Type `/code-reference` and a question about the code, such as `/code-reference how does login work?`, or a PR link to review. Click a numbered box to see that code. |
| ask | Type `/ask` and a question, or `/draw` and something to draw. Press `s` in the pane to send an answer to the main chat. |
| delegator | Nothing to type. When Claude starts a subagent, pick **Approve**, **Change model** or **Refuse**. `/delegator off` turns the approvals off. |

## Change settings

1. In Claude Code, type `/plugin configure` and the mod's full name, such as `/plugin configure user-hud@polar-mods`. In the terminal, `/config` shows the same settings.
2. For user-hud, you can also click into the panel and press `s`.
3. To turn one user-hud module off, type `/hud` and the module, such as `/hud tokens off`. `/hud modules` lists them all.

Every setting is listed in [All settings](#all-settings) below.

## Update or remove

- **Update every mod:** run `python3 ~/.claude/plugins/marketplaces/polar-mods/mods --update`. With user-hud installed, you can type `/user-hud:update-mods` in Claude Code instead.
- **Add or remove mods:** run the quick-start command again and change the ticks. Unticked mods are removed.
- **Remove one mod:** run `claude plugin uninstall ask@polar-mods`, with the mod's name in place of `ask`.

Changes load in the next Claude Code session.

## The mods

### user-hud

![user-hud's panel: model and effort pickers, cache timer, context battery, one session that needs you, three guesses to check, next steps](docs/images/user-hud.png)

A panel above the prompt, made of cards you can turn on or off:

- **Model and effort:** click an option to switch.
- **Cache:** time left on the prompt cache, with a **Keep warm** button and an alert 2 minutes before it expires.
- **Context:** how full the context is, and where the tokens went (`t` for details).
- **Sessions:** your other Claude Code sessions, and which of them need you.
- **Check my guesses:** guesses Claude made for you, to mark right or wrong.
- **Next steps:** after each reply, up to three follow-up prompts; `1`, `2` or `3` puts one in the prompt box.
- **Handoff:** write a handoff note for the next session, or read the newest one.

#### The cache alert

![The cache alert: at 2:00 left the cache card turns yellow, a toast shows in Claude Code and a macOS alert offers Keep warm; pressing it puts the countdown back to 5:00](docs/images/cache-alert.gif)

With 2 minutes left on the cache and Claude idle, two alerts come at once:

- **In Claude Code:** the cache card turns yellow and a toast says how long is left and how many tokens are cached. It stays for 20 seconds.
- **On macOS:** an alert with **Dismiss** and **Keep warm**, and the Glass sound. It closes by itself after 7 seconds (**macOS alert stays** in the settings).

**Keep warm** on the alert, `w` on the panel or `/keepwarm` re-reads the cache, and the countdown starts again from the top. Each alert fires once per countdown.

#### Sessions

<img src="docs/images/sessions.png" width="560" alt="The Sessions pane: Fix the docs build needs you, Move payments tests is working, Release notes 2.4 is done">

The card counts your other sessions by what they need: yellow `●` needs you (a permission prompt or a question is waiting), blue `●` is working, green `✓` is done. `e` opens the Sessions pane with every session listed. Click a session to bring forward the app it runs in, such as your terminal, VS Code or the desktop app. It does not always land on that session: see [Known issues](#known-issues).

More in [plugins/user-hud](plugins/user-hud/README.md).

### code-reference

![A /code-reference reply: linked words with numbered boxes under each section, and the code for box 1 in a pane](docs/images/code-reference.png)

Ask with `/code-reference` and the answer comes back as short sections. Each linked word has a number, and the boxes under each section name the file and lines. Click a box, or press `a` and `d` in the pane, to read that code. Long lines fold so the line numbers still match the file. Give it a GitHub PR link and it reviews the PR the same way.

Press `e` in the pane to open the code in your editor. When the terminal is too narrow for a pane, the code shows in a box under the section instead.

More in [plugins/code-reference](plugins/code-reference/README.md).

### ask

![The main chat on the left, and on the right the ask pane answering a /draw question with a flowchart of the retry loop](docs/images/ask.png)

A side chat in a pane beside the main chat. Each question goes to a copy of the main chat, so the answer knows your whole session, and nothing is added to the main chat unless you press `s`. `/draw` answers with a diagram: box characters in the terminal, a picture in the desktop app. `/ask-rewind` takes back the newest question and answer.

More in [plugins/ask](plugins/ask/README.md).

### delegator

<img src="docs/images/delegator-approve.png" width="640" alt="The approval question for a subagent: Approve, Approve all this turn, Change model, Refuse">

<img src="docs/images/delegator-run.png" width="480" alt="The Delegator pane following a running agent: its character, context, tokens, cost and current step">

When Claude starts a subagent, it waits for you. You see its task and the model it would use, and you choose **Approve**, **Approve all this turn**, **Change model** or **Refuse**. You can also type a note to add to its task. When Claude names no model, the delegator suggests one: Haiku for lookups, Sonnet for building, Opus for design.

The Delegator pane then follows each agent: its context, tokens, estimated cost, time and the step it is on.

More in [plugins/delegator](plugins/delegator/README.md).

## Known issues

- **Start a new session after installing.** Mods load when a session starts.
- **Narrow windows show less.** Below about 40 columns, user-hud shows only its tab. code-reference opens its pane only when the window is wide enough; otherwise the code shows under the section.
- **The VS Code extension and the mobile app draw no panels.** There the mods show plain text and buttons instead.
- **On the desktop app, `/config` has no plugin settings.** Use `/plugin configure <mod>@polar-mods`, or user-hud's `s` key. `/delegator on` and `off` there need `claude` on your PATH.
- **Some links don't open at the line.** Cmd-click opens a code-reference link at the line in VS Code, Cursor, Windsurf and JetBrains terminals. Elsewhere it opens the file, unless **Editor command** names `code`, `cursor` or `windsurf`.
- **Clicking a session brings its app forward, not the session.** A click on a row in user-hud's Sessions card or pane switches you to the app that session runs in (the terminal, VS Code, a JetBrains IDE or the desktop app), but often not to that session's own tab or window. Find the session there yourself.
- **macOS only:** user-hud's macOS alert and its sound. The toast and the yellow card show everywhere.
- **These cost tokens:** each `/ask` question reads the main chat (billed at the cheaper cache-read rate); next steps make one short Haiku call per reply; automatic keep-warm pings, when you turn them on, are billed as cache reads.
- **delegator waits for you.** Every subagent waits until you answer. Use **Approve all this turn**, or `/delegator off`. Turning it off doesn't release agents that are already waiting.

## All settings

Change these with `/plugin configure <mod>@polar-mods` or `/config`. The names below are the names shown there.

### user-hud

| Setting | Default | What it does |
| --- | --- | --- |
| Module: cache | on | Cache timer, Keep warm, the expiry alerts, `/cache`, `/keepwarm`. |
| Module: pickers | on | Model and effort pickers, `/hud-styles`. |
| Module: tokens | on | Context battery, where tokens went, `/tokens`. |
| Module: sessions | on | Your other sessions on this machine. |
| Module: guesses | on | Guesses for you to mark right or wrong. |
| Module: next steps | on | Up to three follow-up prompts after each reply (one short Haiku call). |
| Module: handoff | on | Write and read handoff notes, `/read-handoff`. |
| Module order | pickers, cache, tokens, sessions, assume, next, handoff | The order of the cards. |
| Kept open | next | Cards that never fold when the panel is short of rows. |
| Show the corner panel above the prompt | on | Off hides the panel and its tab. |
| Picker style | rail | How the pickers look: `rail`, `ladder` or `meter`. `/hud-styles` shows all three. |
| Alert when this many seconds are left | 120 | When the cache alert fires. |
| macOS alert | on | Also show a macOS alert with a Keep warm button. |
| macOS alert stays (seconds) | 7 | How long the macOS alert stays. |
| Alert sound | on | Play a sound with the alert. |
| Keep the cache warm automatically | off | Ping the cache 30 seconds before it expires. Each ping is billed as a cache read. |
| Automatic pings per idle stretch | 3 | The most automatic pings between two of your prompts. |
| Handoff note location | (empty) | Where handoff notes live. Empty searches `HANDOFF.md`, `.claude/`, `.claude/handoffs/`, `handoffs/` and `docs/`. |

### code-reference

| Setting | Default | What it does |
| --- | --- | --- |
| Editor command | (empty) | The editor that opens code at a line: `code`, `cursor`, `zed`, `idea`, `goland` and so on. Empty finds the editor you run Claude Code in. |
| gh executable | gh | The GitHub CLI used to read pull requests. Without it, a GitHub MCP server or plain git is used. |
| Offer to install what it can use | on | After install, ask once about the GitHub CLI, Ghostty and terminal-browser. `/code-reference-setup` asks again. |

### ask

| Setting | Default | What it does |
| --- | --- | --- |
| Model before the first turn | haiku | Answers questions asked before the session's first reply. After that, the session's own model answers. |
| Questions kept in the pane | 30 | Older questions scroll away. |

### delegator

| Setting | Default | What it does |
| --- | --- | --- |
| Approve subagents before launch | on | Off, subagents start without asking. `/delegator on` and `/delegator off` change it too. |
| Suggest a model by task complexity | on | When Claude names no model: Haiku for lookups, Sonnet for building, Opus for design. |
| Show the characters | on | A pixel character beside each running agent. |
| Animate the characters | on | The characters move while their agent runs. |
| Ask agents to report their steps | on | Adds one line to each agent's task so it reports its steps to the pane. |

### The `mods` script

Once the marketplace is added, the script is also on disk at `~/.claude/plugins/marketplaces/polar-mods/mods`.

| Option | What it does |
| --- | --- |
| (none) | The checklist: install, update and remove mods, and pick user-hud's modules. |
| `--update` | Update every mod you have, with no questions. |
| `--list` | Show each mod's state and the newest version. It adds the marketplace if needed and changes nothing else. |
| `--dry-run` | Show the `claude plugin` commands instead of running them. |

If you keep delegator and have savvy-progress turned on, the script offers to turn savvy-progress off, because both track the same agents. `claude plugin enable savvy-progress@claude-kit` turns it back on.

### Install by hand

```bash
claude plugin marketplace add hyperbola-bear/claude-mods
claude plugin install user-hud@polar-mods
```

To update: `claude plugin marketplace update polar-mods`, then `claude plugin update <mod>@polar-mods`.

Two mods were renamed: user-hud was `user-hd` before 1.2.0, and code-reference was `pr-review-ui` before 2.0.0. The `mods` script replaces an old install with the new name.

## Develop

Each mod has its own tests:

```bash
claude plugin validate plugins/user-hud && claude plugin test plugins/user-hud
claude plugin validate plugins/code-reference && claude plugin test plugins/code-reference
claude plugin validate plugins/ask && claude plugin test plugins/ask
claude plugin validate plugins/delegator && claude plugin test plugins/delegator
```

Tests don't show what a person sees. To drive a mod in a real Claude Code session and check that the terminal and the desktop app draw the same rows at every width, use the `verify` skill in [.claude/skills/verify](.claude/skills/verify/SKILL.md).
