# code-reference

Replies that point at code. Ask a question with `/code-reference` and the answer comes back as plain prose whose words link to the code they describe. Click one and that code opens in a pane beside the reply. It looks the same in the terminal and in the desktop app.

```
● code-reference · claude-mods · 6 places in the code

  A prompt becomes a review
  Every prompt passes through a prompt.submit hook¹ before the model sees it. The hook
  asks reviewRequest² whether the words add up to a review, attaches the review format³
  and starts the worktree checkout⁴ in the background.

  ─────────────────────────────────────────────────────────────────────────────────────
  ╭─ 1 ──────────────────┬─ 2 ─────────────┬─ 3 ─────────────┬─ 4 ──────────────────╮
  │ register.tsx:792-811 │ review.ts:42-54 │ review.ts:69-80 │ register.tsx:266-294 │
  ╰──────────────────────┴─────────────────┴─────────────────┴──────────────────────╯
```

## Asking

- `/code-reference how does the worker retry failed batches` sends the question with the format.
- Anywhere in a prompt: `explain how x works with y and use /code-reference`.
- `/code-reference` on its own after a long reply. If that reply already names files (`path:line` links or backticked `path:line`), it is redrawn in place. If not, Claude is asked to say it again with links.
- `/code-reference 5` shows place 5 of the reply.
- A pull request: `review https://github.com/acme/billing/pull/12`, a PR link on its own, `review pr`, `review pr 418`, or `/code-reference <PR link>`. **Review when you ask for one** in `/config` turns the typed triggers off.

## How a reply reads

The model writes ordinary markdown: `##` sections, paragraphs, and links whose target is a place in the code, `[the retry loop](src/worker/retry.ts:40-62)`. There are no severity tags and no numbered findings. A PR review opens with one plain sentence saying whether it is ready to merge.

- **Links** are underlined, followed by a small number. Numbers run 1 to N through the whole reply, in the order the text names the places.
- **Under each section**, a rule ends the prose, then one row of boxes, one per place: the number in the top edge, the file and lines inside. The box of the place the pane shows is outlined in Claude's color.
- **With no headings**, each paragraph or list that names code gets its own row of boxes.
- Without the mod (another client, or the plugin uninstalled) it is still plain markdown, and the desktop app opens those links in its file pane.

## The code pane

One header line: the place's number and path, where the code comes from (`local`, `uncommitted edits`, `changed in the PR`, `from GitHub`), `↑ ↓` to scroll, `editor`, and `github` for a PR. Everything below it is code, read from disk:

- **Explaining:** the files in the session's folder. Uncommitted edits, branches you never pushed and repositories with no remote all work. Lines that differ from the last commit are marked like `git diff`.
- **Reviewing:** the PR's review worktree (below), the PR's changes marked.

The place's lines carry a `▌` mark. When the pane has focus: the arrow and page keys scroll, `a` and `d` (or ← →) step through the places, `e` opens the editor, `o` the PR's page. `editor` opens the file at the line in the editor you run Claude Code in, or the one named by **Editor command** in `/config`.

Close the pane and the code shows under its section instead, with `open in pane`. On a terminal narrower than the docking width, or on the main screen (not fullscreen), it shows there too.

## Pull requests

A PR is read with the GitHub CLI when it is installed and signed in. Without it, the mod uses a connected GitHub MCP server's tools (`get_pull_request`, `get_file_contents`), and without that, plain git: `git ls-remote` for `refs/pull/<n>/head`, with the git credentials you already have.

The PR's head is checked out into a **review worktree**, `~/.cache/code-reference/review/<repo>-<PR>-<sha>`, with `HEAD` moved back to where the PR branched. Git then sees the PR as uncommitted edits, so the pane, `git diff` and every editor's change marks show exactly what the PR changed. When the session's folder is the PR's repository, the worktree hangs off your checkout (the PR is fetched under `refs/code-reference/`, so none of your branches move). Otherwise the repository is cloned once into `~/.cache/code-reference/repos/`. The worktree is removed when the session ends.

Only when no copy is on disk (the checkout failed) does the code come from GitHub.

`github` opens the PR's page at those lines: in terminal-browser in Ghostty or kitty when it is installed, else in your browser. If terminal-browser can't load it, the pane keeps the code and says so, with `retry`.

## Why it looks the same everywhere

The reply and the pane are each one `Client` region. The mod lays out every row itself at the width the app reports: it wraps the prose, draws the boxes and cuts the code lines. Then it draws rows of `Text`, which both apps draw in their code font on a grid of cells. It draws no `Markdown` and no `Button`, because the desktop app draws those natively. Clicks come back as the cell under the pointer and are matched to what was drawn. Colors are theme keys, so each app keeps its own light or dark theme.

## Setup

The first session after you install it asks, one tool at a time, whether to install what it can use and this machine lacks. None is required:

| Tool | Why | How it installs |
| --- | --- | --- |
| The GitHub CLI | reads PRs fastest | `brew install gh`, then `gh auth login` in a terminal |
| Ghostty (macOS) | a terminal that can show GitHub pages | `brew install --cask ghostty` |
| terminal-browser | draws a PR's page in Ghostty or kitty | `brew install terminal-browser`, then its Claude Code plugin |

Each question offers **Install**, **Not now** and **Don't ask again**. `/code-reference-setup` asks again; **Offer to install what it can use** in `/config` turns the questions off.

## What it can reach

`claude plugin validate .` lists it: `$.process.run` (gh, git, brew and claude when you agree to an install, uname, open, your editor's command line), a GitHub MCP server's tools when one is connected, terminal-browser's `$.browser` (when installed, on `github`), file reads for the code it shows, file writes only for read-only PR-head copies the editor opens when no worktree can be made, the transcript (for `/code-reference` alone), and its store (which setup questions you answered). It writes in your repository's `.git` only to fetch a PR under `refs/code-reference/` and to register the review worktree.
