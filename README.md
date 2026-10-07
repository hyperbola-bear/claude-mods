# claude-mods

Polar's Claude Code mods, as one plugin marketplace (`polar-mods`) with two plugins:

| Plugin | What it does |
| --- | --- |
| [user-hd](plugins/user-hd) | A band above the prompt: prompt-cache countdown with a 2-minute keep-warm alert, and Handoff / Read handoff buttons. |
| [pr-review-ui](plugins/pr-review-ui) | PR reviews as numbered points in one standard format. Say "review" with a PR link (or "review pr") and the PR is checked out into a review worktree; each point's code opens beside the review with the changes highlighted: in your editor from a VS Code, JetBrains, Zed or Neovim terminal, in terminal-browser from Ghostty or kitty, or in a code pane. |

Both draw on the band above the prompt and keep each other's rows, so they work together or alone.

## Install

In a terminal:

```
claude plugin marketplace add hyperbola-bear/claude-mods
claude plugin install user-hd@polar-mods
claude plugin install pr-review-ui@polar-mods
```

Then start a new Claude Code session. Mods need Claude Code 2.1.287 or later.

## Update

```
claude plugin marketplace update polar-mods
claude plugin update user-hd@polar-mods
claude plugin update pr-review-ui@polar-mods
```

## Develop

Each plugin has its own tests:

```
claude plugin validate plugins/user-hd && claude plugin test plugins/user-hd
claude plugin validate plugins/pr-review-ui && claude plugin test plugins/pr-review-ui
```
