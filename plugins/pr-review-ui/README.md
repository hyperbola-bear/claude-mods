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
- Opening a point shows its **first code location** in terminal-browser beside the conversation: the PR's Files tab with those lines highlighted, or the file at the PR head when the PR did not change them.
- A point that involves more than one place lists them as **Code:** chips. Click one, or press `s` on the band, to step through them. Each backticked `path:line` in the comment is a link to that location too.
- The band above the prompt shows the point numbers. Press `1`–`9` to jump, even from an empty prompt; `j` / `k` for next and previous and `x` to finish need the band focused (click it, or ctrl+x then tab). It also shows where you are as `infra/` `iam.tf:45-48`, folder dim and file bold.
- `/point 2` or `/point 1 2` (point 1, code location 2) does the same from the prompt.

terminal-browser needs Ghostty or kitty, and a GitHub sign-in inside it for private repos. Opening a page gives the browser the keyboard; press Esc to get back to the prompt. Without terminal-browser, for a local review, or with **Where review code shows** set to `pane` in `/config`, a code pane of this mod's own shows the same lines instead.

## Needs

- The GitHub CLI: `brew install gh && gh auth login`.
- For the code beside the review: terminal-browser (`brew install terminal-browser`, then `claude plugin marketplace add zenbu-labs/terminal-browser` and `claude plugin install terminal-browser@terminal-browser`), in Ghostty or kitty.

## What it can reach

`claude plugin validate .` lists it: `$.process.run` (gh, git, open), terminal-browser's `$.browser` (when installed) and file reads for local reviews. It writes no files.
