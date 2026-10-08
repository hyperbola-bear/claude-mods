---
name: reply-format
description: Answer in the code-reference format, whose links the code-reference plugin opens beside the reply in a code pane. Use whenever the user asks for a code reference or mentions /code-reference, asks to explain how code works and see the code behind it, or asks to review a GitHub pull request (a github.com/.../pull/N link, "review pr", "review pr 418", "pr review").
argument-hint: "[question, or PR URL or number]"
---

# Code reference: prose linked to the code

Answer what `$ARGUMENTS` asks in the code-reference format. code-reference draws the reply: each link is underlined with a number, each section ends in a row of boxes (one per place in the code), and a click shows that code beside the reply.

## Explaining code

1. First line, exactly: `**Code reference:** <absolute path of the repository root>`.
2. Then plain markdown. When the answer has more than one part, give each a `##` heading saying what it covers; one or two short paragraphs each.
3. Link every place in the code you talk about, on the words that describe it: `[the retry loop](src/worker/retry.ts:40-62)`. The target is the path relative to the repository root, then `:line` or `:start-end` in the file as it is now. Open the file first so the lines are right. Link the lines that matter, not whole files.
4. Name places in the order the reader should look at them. Never put a link inside a code block.
5. No severity tags, no numbered findings, no tables of files.

## Reviewing a pull request

Read it with `gh pr view <pr>` and `gh pr diff <pr>` (add `-R owner/repo` when the number is not in this repository), or the GitHub MCP tools when gh is missing. code-reference checks the PR out into a review worktree under `~/.cache/code-reference/review/`; when the prompt names that folder and it exists, read whole files there and link paths relative to it. Never edit or commit in it.

Look for correctness, security, concurrency and data-loss risks first, then maintainability. Check claims against the code. Skip praise and nits a formatter would fix. Do not post comments, approve, or push anything.

1. First line, exactly: `**Code reference:** <the PR URL>`.
2. Then one plain sentence: whether it is ready to merge and why ("Not ready to merge: the IAM pattern stops the first deploy." / "Ready to merge.").
3. Then one or two sentences on what the PR does.
4. Then one `##` section per issue, most important first, the heading saying what is wrong in plain words. In it: what the code does, what goes wrong and for whom, and the fix, each place linked as above; a ` ```diff ` block of at most 8 lines when it helps.
5. With nothing to fix: the verdict sentence and a short list of what you checked.

## Example

**Code reference:** https://github.com/acme/billing/pull/12

Not ready to merge: the IAM pattern stops the first deploy.

Moves billing events from the S3 sink to Firehose.

## PassRole is scoped to a pattern the roles don't match

[The `iam:PassRole` statement](infra/iam.tf:42-48) allows `*billing-worker*`, but [the Firehose role](infra/firehose.tf:17) is `billing-pipe-role`. Creating the delivery stream fails with a 403 after the role exists, leaving a half-built stack. Match the stack's prefix instead:

```diff
-      "arn:aws:iam::${var.account_id}:role/*billing-worker*",
+      "arn:aws:iam::${var.account_id}:role/billing-*",
```
