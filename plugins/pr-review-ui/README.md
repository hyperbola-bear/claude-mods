# pr-review-ui

PR reviews as numbered points in the conversation, with each point's code beside it.


Paste a PR link and say review, for example `review https://github.com/acme/billing/pull/12`. The mod sees the word review and the PR link, and asks Claude for the review in its points format, so no slash command is needed (`/pr-review-ui:pr-review <PR URL>` still works, and **Review when you paste a PR link** in `/config` turns the trigger off). Claude reviews it as numbered points, and the mod draws them in the conversation:

```
● PR review · your-org/billing-worker #418 · 5 points · 2 high · 2 medium · 1 nit
  high   ▾ 1. Resource pattern misses roles this stack creates
           …the comment…
           Code: [ infra/iam.tf:45-48 ] [ infra/firehose.tf:15 ]
  high   ▸ 2. PassRole has the same gap: a second wave of 403s
  medium ▸ 3. Update and destroy actions are missing
```

- The point you are on is open; the others fold to one line. Click a point to open it.
- As soon as the review text arrives, point 1's **first code location** shows beside the conversation, and it follows you from point to point. Where it shows depends on your terminal (below).
- A point that involves more than one place lists them as **Code** chips, the one shown marked `▸`. Click another, or press `s` on the band, to step through them. Each backticked `path:line` in the comment is a link to that location too.
- The band above the prompt shows the point numbers. Press `1`–`9` to jump, even from an empty prompt; `j` / `k` for next and previous, `v` to show the code again and `x` to finish need the band focused (click it, or ctrl+x then tab). It also shows where you are as `infra/` `iam.tf:45-48 · in the editor`, folder dim and file bold.
- `/point 2` or `/point 1 2` (point 1, code location 2) does the same from the prompt.

## Where the code shows

**Where review code shows** in `/config` is `auto` by default, which follows the terminal Claude Code runs in:

| You run Claude Code in | The code shows in |
| --- | --- |
| VS Code's terminal (or Cursor, Windsurf) | the editor, at the point's line |
| A JetBrains IDE's terminal (IntelliJ, GoLand, PyCharm…) | the IDE, at the point's line |
| Ghostty or kitty, with terminal-browser installed | terminal-browser: the PR's Files tab with the lines highlighted, or the file at the PR head |
| Anything else, and the desktop app | the code pane: the lines marked `▌`, the point's other locations, and the PR's files with `●` on the ones the point touches |

Set it to `ide`, `browser` or `pane` to always use one.

### In your editor

When the session's folder is the PR's repository and your checkout is on the PR's head commit, the editor opens your own files, so you can read around, jump to definitions and run things while the review moves along. When it is not, the editor opens a read-only copy of the file at the PR head (under your temp folder) and the band offers **Check out PR** (`c`), which runs `gh pr checkout` in the session's folder; after that the editor follows your checkout.

- VS Code: uses the command line of the editor you run Claude Code in (so Cursor opens Cursor), else `code`, so there is nothing to set up. Each point reuses the window.
- JetBrains: opens the file in the IDE you run Claude Code in. If that does not work, set **Editor command** in `/config` to its launcher, such as `idea` or `goland` (Toolbox: Settings, Tools, Shell scripts).
- **Editor command** also lets you use an editor from any terminal: `code`, `cursor`, `idea`, `goland` and so on.

The editor takes the focus each time a point opens; click the terminal, or use your IDE's terminal shortcut, to get back to Claude.

### In terminal-browser

terminal-browser needs Ghostty or kitty with no tmux in between, and a GitHub sign-in inside it for private repos. Opening a page gives the browser the keyboard; press Esc to get back to the prompt. If it cannot draw (the VS Code terminal cannot), the code pane takes over.

### In the code pane

A pane opened by itself needs a terminal at least 144 columns wide. In a narrower one the mod says so once; press a point number or **Show code** (`v`) on the band to open it at any width.

## Needs

- The GitHub CLI: `brew install gh && gh auth login`.
- Optional, for GitHub pages beside the review: terminal-browser (`brew install terminal-browser`, then `claude plugin marketplace add zenbu-labs/terminal-browser` and `claude plugin install terminal-browser@terminal-browser`), in Ghostty or kitty.

## What it can reach

`claude plugin validate .` lists it: `$.process.run` (gh, git, open, your editor's command line), terminal-browser's `$.browser` (when installed), file reads for local reviews, and file writes for the read-only PR-head copies the editor opens, under your temp folder in `pr-review-ui/`. It changes your checkout only when you press **Check out PR**.
