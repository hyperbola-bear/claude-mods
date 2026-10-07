# pr-review-ui

PR reviews as numbered points in the conversation, each point's code beside it, the PR's changes highlighted like `git diff`.

## Starting a review

Any of these starts one, with no slash command needed:

- `review https://github.com/acme/billing/pull/12` (any wording with review, look over or go over, and a PR link)
- a PR link on its own
- `review pr` or `pr review` (the PR of the branch you are on), `review pr 418` or `review #418` (a PR of this repository)

`/pr-review-ui:pr-review <PR URL or number>` still works, and with nothing after it reviews your uncommitted changes. **Review when you ask for one** in `/config` turns the typed triggers off.

As soon as the review is asked for, the mod checks the PR out into a **review worktree** (below). When Claude's review arrives, point 1 is open and its code is already showing: nothing to click.

## How a review reads

Every review follows one standard, so it reads the same in the terminal, in the desktop app, and as plain markdown where the mod is not installed:

```
● Review · acme/billing-worker #418 · Stream billing events to S3 through Firehose
  feat/firehose-sink → main · @mlee · 7 files +93 −15
  ✗ Changes requested    HIGH  2    MED  2    NIT  1
  Moves billing events from the S3 sink to Firehose. The IAM changes stop the first deploy.

  ▾ 1  HIGH  CreateRole pattern misses the Firehose role this stack creates   correctness
       Problem  The pattern matches billing-worker, but the role is billing-pipe-role…
       Impact   The first terraform apply stops with AccessDenied…
       Fix      Match the stack's prefix:
                -  "arn:aws:iam::${var.account_id}:role/*billing-worker*",
                +  "arn:aws:iam::${var.account_id}:role/billing-*",
       Code  ▸ infra/iam.tf:42-44   infra/firehose.tf:13-14
  ▸ 2  HIGH  PassRole is granted on every role in the account                   security
  ▸ 3  MED   A partial failure resends the whole batch                          correctness

  Plan     Before merge 1 2   Before production traffic 3 4   Any time 5
  Verdict  Not ready to merge: the IAM gaps stop the first deploy.
```

- **Severity** is one of critical, high, medium, low, nit, drawn as a colored tag. The skill says what each means.
- **Area** is one of correctness, security, reliability, performance, data, tests, naming.
- The open point shows **Problem**, **Impact** and **Fix**, then the suggested change with the changed words highlighted. The others fold to one line; click one to open it.
- **Code** chips are the point's code locations, the one shown marked `▸`. Each backticked `path:line` in the text is a link to that location too.
- The **Plan** numbers are links to their points.

Reviews written in the 1.1.0 format (no area, prose bodies) still draw.

## The band above the prompt

```
#418 [ 1 ] [ 2 ] [ 3 ] [ 4 ] [ 5 ]  a: ‹  d: ›  │ infra/iam.tf:42-44  s: code 1/2  │ in the code pane  v: show  x: done
```

- `1`–`9` jump to a point, even from an empty prompt.
- With the band focused (click it, or ctrl+x then tab): `a` and `d` for the previous and next point, `s` for the point's next code location, `v` to show the code again, `x` to finish. Letters need the band focused because in the prompt they are text.
- **done** closes the pane and removes the review worktree.
- `/point 2` or `/point 1 2` (point 1, code location 2) does the same from the prompt.

## The review worktree

The PR's head is checked out into a folder of its own, `~/.cache/pr-review-ui/review/<repo>-<PR>-<sha>`, and its `HEAD` is moved back to where the PR branched (`git reset --mixed <merge-base>`). The files are the PR's, but git sees the PR as uncommitted edits, so `git diff`, the code pane and every editor's own change marks show exactly what the PR changed. Files the PR adds are marked intent-to-add, so they show as added.

- When the session's folder is the PR's repository, the worktree hangs off your checkout (the PR is fetched under `refs/pr-review-ui/`, so none of your branches move). Your files and uncommitted work are never touched.
- When it is not, the repository is cloned once into `~/.cache/pr-review-ui/repos/` (no checkout) and reused by later reviews.
- Claude is told the folder, so it can read whole files there.
- **done** (`x`) removes the worktree; the fetched commits stay for the next review. A newer head of the same PR replaces the older folder.

If the worktree cannot be made (no git, the fetch fails), the code comes from GitHub as in 1.1.0: the diff hunks in the pane, and a read-only copy of the file at the PR head in the editor.

## Where the code shows

**Where review code shows** in `/config` is `auto` by default, which follows the terminal Claude Code runs in:

| You run Claude Code in | The code shows in |
| --- | --- |
| VS Code's terminal (or Cursor, Windsurf) | the editor, at the point's line |
| A JetBrains IDE's terminal (IntelliJ, GoLand, PyCharm…) | the IDE, at the point's line |
| Zed's terminal | Zed, at the point's line |
| Neovim's `:terminal` | Neovim, in the window beside the terminal (a new split if it is alone) |
| Ghostty or kitty, with terminal-browser installed | terminal-browser: the PR's Files tab with the lines highlighted |
| Anything else (iTerm2, Terminal, Warp, WezTerm, tmux, SSH, Ghostty without terminal-browser) and the desktop app | the code pane |

Set it to `ide`, `browser` or `pane` to always use one.

### In your editor

The editor opens the review worktree's file at the point's line, so the PR's changes are in its change marks (VS Code's and Zed's gutter, JetBrains' change markers, gitsigns.nvim or mini.diff in Neovim) and you can read around, jump to definitions and run things while the review moves along. The editor takes the focus each time a point opens; click the terminal to get back to Claude.

- VS Code: uses the command line of the editor you run Claude Code in (so Cursor opens Cursor), else `code`.
- JetBrains: opens the file in the IDE you run Claude Code in. If that does not work, set **Editor command** in `/config` to its launcher, such as `idea` or `goland`.
- Zed: `zed`, from Zed's menu, Install CLI.
- Neovim: through `$NVIM`, the socket of the Neovim whose terminal Claude Code runs in.
- **Editor command** also lets you use an editor from any terminal: `code`, `cursor`, `zed`, `idea`, `goland` and so on.

### In terminal-browser

terminal-browser needs Ghostty or kitty with no tmux in between, and a GitHub sign-in inside it for private repos. Opening a page gives the browser the keyboard; press Esc to get back to the prompt. If it cannot draw, the code pane takes over. The worktree is still made, so the pane and **Open in editor** work.

### In the code pane

The pane draws the PR's change like `git diff`: old and new line numbers, the point's lines marked `▌`, added and removed lines on their colors, the changed words stronger. **↑ / ↓ more lines** show more of the file from the worktree; **Open in editor** (`e`) and **GitHub** (`o`) open the location elsewhere; `a` and `d` step points when the pane is focused. Under the code, the PR's files, `●` on the ones the point touches.

The pane docks beside the transcript from 144 columns, in Claude Code's fullscreen layout. In a narrower terminal the code shows under the open point instead, and once you widen the terminal past 144 columns the pane docks and the code moves into it. On the main screen (not fullscreen) the code also shows under the point; `v` opens the pane. The desktop app always uses its side pane.

## Setup

The first session after you install the plugin checks for what it uses and asks, one tool at a time, whether to install what is missing. Nothing is installed without a yes:

| Tool | Why | How it installs |
| --- | --- | --- |
| The GitHub CLI | reads the PR (required) | `brew install gh`, then sign in once with `gh auth login` in a terminal |
| Ghostty (macOS) | a terminal that can show GitHub pages | `brew install --cask ghostty` |
| terminal-browser | draws the PR's Files tab in Ghostty or kitty | `brew install terminal-browser`, then its Claude Code plugin; restart Claude Code after |

Each question offers **Install**, **Not now** and **Don't ask again**. After that, a review asks only when the GitHub CLI is missing. `/review-setup` asks about everything missing again, and **Offer to install what it needs** in `/config` turns the questions off. Installing needs Homebrew; without it the mod says so and installs nothing.

## What it can reach

`claude plugin validate .` lists it: `$.process.run` (gh, git, brew and claude when you agree to an install, uname, open, your editor's command line), terminal-browser's `$.browser` (when installed), file reads for the code it shows, file writes only for the read-only PR-head copies used when no worktree can be made (under your temp folder in `pr-review-ui/`), and its store (which setup questions you answered). It writes in your repository's `.git` only to fetch the PR under `refs/pr-review-ui/` and to register the review worktree.
