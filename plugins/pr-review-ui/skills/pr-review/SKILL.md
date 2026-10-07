---
name: pr-review
description: Review a GitHub pull request, or the local uncommitted changes, as numbered points whose code pr-review-ui opens beside the conversation. Use whenever the user asks to review something and pastes a GitHub pull request link (github.com/.../pull/N), asks to review a PR, or asks to review a branch's changes or the working tree.
argument-hint: "[PR URL or number, or nothing for local changes]"
---

# PR review as points, code beside it

Review what `$ARGUMENTS` names:

- A PR URL or number: read it with `gh pr view <pr>` and `gh pr diff <pr>` (add `-R owner/repo` when the number is not in this repository). Read the full files around the changes when the diff alone does not show enough.
- Nothing: review the uncommitted changes with `git diff HEAD` and `git status`.

Look for correctness, security, concurrency and data-loss risks first, then maintainability. Check claims against the code: open the file before saying a line does something. Skip praise and style nits a formatter would fix. Do not post comments, approve, or push anything.

## Output format (the code pane parses this exactly)

1. First line: `**PR review:** <full PR URL>` for a PR, or `**Local review:** <absolute repository root>` for local changes.
2. One section per finding, most severe first, numbered from 1, each opening with a heading exactly like:

   ### [1] high · `src/billing/iam.tf:42-48` — Role ARN pattern misses the promtail role

   - Severity is one of `critical`, `high`, `medium`, `low`, `nit`.
   - The path is relative to the repository root, in backticks, with the line or range in the head version of the file.
3. Under each heading: what is wrong, why it matters, and the fix, with a short code block when it helps. Keep each point to one issue: the reader steps through points one at a time.
4. When a point involves code in more than one place (the line that is wrong and the line it fails to match, a caller and its callee), name every other place as `path:line` or `path:start-end` in backticks, in the order the reader should look at them. Each one becomes a code location of that point: the reader opens the heading's location first, then steps to these. Name only places that matter to the point, and never put such a reference inside a code block.
5. End with `### Summary` (no number): the overall risk, and whether it is ready to merge.

Example:

**PR review:** https://github.com/acme/billing/pull/12

### [1] high · `infra/iam.tf:42-48` — PassRole scoped to a pattern the roles do not match

The `iam:PassRole` statement allows `*billing-worker*`, but the Firehose role is `billing-pipe-role` (see `infra/firehose.tf:17`), so creating the delivery stream fails with a 403 after the role itself is created.

Fix: widen the resource to `arn:aws:iam::*:role/*-billing-*` or list the roles explicitly.

### Summary

One blocking issue (finding 1); the rest is ready.
