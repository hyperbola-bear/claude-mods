---
name: pr-review
description: Review a GitHub pull request, or the local uncommitted changes, as numbered points whose code pr-review-ui opens beside the conversation (in the editor, terminal-browser or a code pane). Use whenever the user asks to review something and pastes a GitHub pull request link (github.com/.../pull/N), says "review pr", "review pr 418", "pr review", asks to review a PR, or asks to review a branch's changes or the working tree.
argument-hint: "[PR URL or number, or nothing for local changes]"
---

# PR review as points, code beside it

Review what `$ARGUMENTS` names:

- A PR URL or number: read it with `gh pr view <pr>` and `gh pr diff <pr>` (add `-R owner/repo` when the number is not in this repository). pr-review-ui checks the PR out into a review worktree under `~/.cache/pr-review-ui/review/`; when the prompt names that folder and it exists, read whole files there rather than through `gh api`. Never edit or commit in it.
- Nothing: review the uncommitted changes with `git diff HEAD` and `git status`.

Look for correctness, security, concurrency and data-loss risks first, then maintainability. Check claims against the code: open the file before saying a line does something. Skip praise and style nits a formatter would fix. Do not post comments, approve, or push anything.

## Output format (pr-review-ui parses this exactly)

1. First line: `**PR review:** <full PR URL>` for a PR, or `**Local review:** <absolute repository root>` for local changes.
2. A blank line, then `**Verdict:** <verdict> · <the PR's title>`, the verdict being one of `ready to merge`, `ready after nits`, `changes requested`.
3. One or two sentences: what the PR does and what blocks it.
4. One section per finding, most severe first, numbered from 1, each opening with a heading exactly like:

   ### [1] high · correctness · `src/billing/iam.tf:42-48` — Role ARN pattern misses the promtail role

   - Severity, from the scale below.
   - Area: one of `correctness`, `security`, `reliability`, `performance`, `data`, `tests`, `naming`.
   - The path is relative to the repository root, in backticks, with the line or range in the head version of the file.
   - The title says what is wrong, in under 70 characters.
5. Under each heading, three bullets in this order, then the suggested change when it helps:

   - **Problem:** what the code does, naming the line.
   - **Impact:** what goes wrong, for whom, and when.
   - **Fix:** one sentence.

   A ` ```diff ` block of at most 8 lines with the change. Keep each point to one issue: the reader steps through points one at a time.
6. When a point involves code in more than one place (the line that is wrong and the line it fails to match, a caller and its callee), name every other place as `path:line` or `path:start-end` in backticks, in the order the reader should look at them. Each one becomes a code location of that point: the reader opens the heading's location first, then steps to these. Name only places that matter to the point, and never put such a reference inside a code block.
7. End with `### Summary` (no number): a merge plan line, `**Before merge:** 1, 2 · **Before production traffic:** 3, 4 · **Any time:** 5` (leave out empty groups), then one sentence saying whether it is ready to merge.
8. With nothing to fix, keep the first line, the verdict (`ready to merge`), the lead and the summary, and write no numbered sections. What you checked can go in the lead, as a short list.

### Severity

| Severity | When |
| --- | --- |
| `critical` | Data loss, a security hole or an outage in production. Blocks merge. |
| `high` | Wrong on a main path, or a security gap. Blocks merge. |
| `medium` | Wrong on an edge path. Fix before real traffic. |
| `low` | Fragile or unclear; fix when convenient. |
| `nit` | Naming or wording. Never blocks. |

## Example

**PR review:** https://github.com/acme/billing/pull/12

**Verdict:** changes requested · Stream billing events through Firehose

Moves billing events from the S3 sink to Firehose. The IAM scoping stops the first deploy.

### [1] high · correctness · `infra/iam.tf:42-48` — PassRole scoped to a pattern the roles do not match

- **Problem:** The `iam:PassRole` statement allows `*billing-worker*`, but the Firehose role is `billing-pipe-role` (see `infra/firehose.tf:17`).
- **Impact:** Creating the delivery stream fails with a 403 after the role itself is created, leaving a half-built stack.
- **Fix:** Match the stack's prefix instead.

```diff
-      "arn:aws:iam::${var.account_id}:role/*billing-worker*",
+      "arn:aws:iam::${var.account_id}:role/billing-*",
```

### Summary

**Before merge:** 1

Not ready to merge: the IAM pattern stops the first deploy.
