# Claude mods improvements

Status: implementation plan, 11 October 2026. This document records requested behavior and reviewable implementation slices; it does not claim that the features below are implemented.

Update, 12 October 2026: slices 1–4 shipped as their own plugin, `delegator` 0.1.0, not inside user-hud. The live proof found that a pane cannot hold a spawn (a hook has 10 s of its own time, and one that runs out lets the agent start) and that a dialog holds the keys, so the engine's question dialog is the hold, edits are made through it (Change model, and typed notes), and the pane shows the queue and the full task. Slice 7 shipped in user-hud 1.5.2.

## Ticket Summary

- **Goal:** Add a subagent delegator to `user-hud`. Before any subagent starts, show its proposed task and model in a pane. Let the person edit the task, choose a model tier, approve, or refuse it. Provide **Approve all** for a burst of proposed agents, and an on/off setting. Make the user-hud area and the separately installed `next-steps@claude-community` suggestions sit side by side when there is enough width, with user-hud on the left and next steps on the right. Also improve the five token-efficiency issues identified in the current mods.
- **Definition of done:** With approval enabled, no covered agent begins before an explicit approval. The approved task and model reach the agent exactly as shown. Approve all handles the current batch without granting permanent approval. With approval disabled, agent spawning behaves as it did before. Both plugins remain usable at narrow and wide widths. Token changes are measured against a repeatable baseline.
- **Scope:** `user-hud`, `ask`, and `code-reference` in this marketplace. `next-steps` stays a separately installed plugin; use its public UI behavior as a reference and preserve its own controls. Do not copy its suggestion generator into user-hud.
- **Non-goals:** Implementing these features in this documentation change, changing the separately installed next-steps plugin, or automatically approving future sessions.
- **Open questions for slice 1:** Whether a custom pane can safely hold `agent.spawn` during editing and concurrent approvals; whether command input is available during a held turn; which model tiers are supported by the active Claude Code build. “Model level” means the model tier here. Agent effort is a separate control: `agent.spawn` exposes `model` but no `effort`, so effort editing would need a separately verified mechanism.

## Context Map

| Area | Current behavior and relevant files |
| --- | --- |
| Subagent lifecycle | Claude Code's `agent.spawn` mod event fires before a subagent starts. Its input includes `prompt`, `description`, `subagentType`, `model`, `parentModel`, `parentAgentId`, and `tool_use_id`. A mod can pass edited `prompt` and `model` to `next(e)`, or return `{ deny: reason }`. A missing `model` can mean an agent-specific default or inheritance, so the pane must not label it as a known effective model without resolving it. Forked agents inherit the parent model and ignore a model override. [Mod reference](https://code.claude.com/docs/en/plugins/mods/reference) · [Agent spawn types](https://github.com/anthropics/claude-code/blob/main/mods/types/claude-code.d.ts) |
| Approval UI | Mods can render a pane. The documented `$.ui.ask` example safely pauses a tool call; applying that pattern to `agent.spawn`, a custom-pane wait, simultaneous pending spawns, command input while a turn runs, and timeout behavior need a small live proof before the final design is fixed. [Event guide](https://code.claude.com/docs/en/plugins/mods/events) |
| user-hud | Its existing settings, actions, and `AbovePrompt` render live in `plugins/user-hud/hooks/register.tsx`; the grid layout lives in `plugins/user-hud/hooks/panelgrid.ts`, and configuration in `plugins/user-hud/.claude-plugin/plugin.json`. `showBand` controls display, so approval needs its own independent setting. |
| next-steps | The public community version uses `turn.complete` plus one model fork to suggest prompts, and an `AbovePrompt` render hook to display them. Selecting a suggestion fills the prompt as an editable draft. Its current render wraps the result of `next(e)` vertically, which explains why two independent bands can stack. It currently draws suggestions only in the terminal. The version installed on the other computer may differ. [Source](https://github.com/anthropics/claude-plugins-community/blob/main/next-steps/hooks/register.tsx) · [README](https://github.com/anthropics/claude-plugins-community/blob/main/next-steps/README.md) |
| Token accounting | `user-hud` already records API usage and attributes plugin model calls in `plugins/user-hud/hooks/tokens.ts`. Group allocations use estimates; API totals are the measurement baseline. |

## Proposed subagent flow

1. A pending `agent.spawn` creates a queue item keyed by `tool_use_id`, with the full task, short description, agent type, requested model, parent model, and parent agent. The pane opens and shows a concise list plus the selected item's complete editable task.
2. The model control offers supported model tiers and **Inherit**. Show the requested value and an effective-model preview only when it can be established. For a fork, show **Inherited and locked**. After approval and launch, the result of `next(e)` supplies the resolved model for confirmation in the UI/history.
3. **Approve** calls `next` once with the selected task and model. **Refuse** returns a clear denial to the calling agent. Closing the pane or losing the UI while approval is required must refuse or continue waiting; it must never silently approve.
4. **Approve all** applies to every pending item and to later proposals in the same main turn, then expires when that main turn completes. The pane and command must state this exact scope and count. A later turn requires approval again. Edited items retain their edits. A separate command such as `/hud-agents approve-all` provides keyboard access.
5. The `/config` setting **Approve subagents before launch** enables or disables the gate. Default off for existing installations. Turning it off releases no pending request automatically: ask how to resolve the pending queue or refuse it explicitly. The setting is independent of `showBand`.
6. Cover nested subagents, agent-team teammates, and plugin-created agents if they pass through `agent.spawn`. Confirm which paths actually fire the event in the installed Claude Code build. Resuming an existing agent via `SendMessage` is a separate operation and is outside this launch gate unless explicitly added later.

### Interaction sketch

```text
┌─ user-hud / Delegator ─────────────────────────────┐  ┌─ next steps ─────────────┐
│ Pending 3   [Approve] [Refuse] [Approve all: turn] │  │ 1 run tests             │
│ 1 Explore · inspect cache tests · Haiku            │  │ 2 open draft PR         │
│ 2 general · implement retry · Sonnet               │  │ 0 dismiss               │
│ Task: [editable full prompt]   Model: [selector]   │  └──────────────────────────┘
└─────────────────────────────────────────────────────┘
```

On a narrow terminal, stack the sections or open the delegator in its own pane without clipping the task or hiding the approval actions. The wide layout is a desired result, not an assumption that another plugin's render tree can be reparented safely. Test both hook orders and both installed/absent states of next-steps. Do not depend on private next-steps state or change its source.

## Slices

| # | Slice and likely files | Acceptance check | Suggested implementation prompt |
| --- | --- | --- | --- |
| 1 | **Prove the gate.** Add a temporary test mod or focused tests around `agent.spawn`, pane input, multiple simultaneous calls, timeout, and headless behavior. | A spawn waits for a person; edit and model override reach the agent; refusal starts none; timeout or missing UI never silently allows one. Record the supported interaction mechanism before building UI. | “Explore the installed Claude Code mod API and implement only a disposable approval-gate proof. Test concurrent `agent.spawn` calls and report the safe wait mechanism and limits.” |
| 2 | **Queue and approval state.** Add a pure queue module, state type, and tests under `plugins/user-hud/hooks/` and `tests/`. | Each `tool_use_id` resolves once; concurrent and nested requests stay distinct; cancellation and session end resolve every waiter safely. | “Implement the delegator queue state and its tests only, using the gate contract from slice 1.” |
| 3 | **Editable pane and model selection.** Add pane rendering and actions in user-hud, with a separate layout module if needed. | Full task and agent type are readable; task edits and model choice are reflected in the spawn; inherited/fork model limitations are stated accurately; keyboard and pointer work. | “Implement one pending agent's review pane, task editor, model selector, approve and refuse actions.” |
| 4 | **Batch approval and setting.** Extend `register.tsx`, `plugin.json`, settings grid, README, and tests. | Approve all covers the pending queue and remainder of its main turn only; next turn gates again; off bypasses the gate; changing settings during pending work is deterministic. | “Add the approval toggle and turn-scoped approve-all command, with concurrency and lifecycle tests.” |
| 5 | **Coexistence layout.** Adjust user-hud `AbovePrompt` composition and grid fit behavior; integration-test with the public next-steps plugin. | Wide terminal shows user-hud left and next steps right in either load order; controls from both work. Narrow terminal and desktop have an intentional fallback. If the public render API cannot guarantee this across independent plugins, document the exact limitation and propose an upstream layout hook. | “Integrate user-hud and next-steps visually using only public render APIs; prove both plugin orders and narrow-width fallback.” |
| 6 | **Bound ask history.** `plugins/ask/hooks/answer.ts`, `register.tsx`, tests. | A follow-up retains recent context but has a configurable or fixed character/token budget; older answers are shortened or summarized; prompt size stays bounded after long replies. | “Cap pane history added to each `ask` fork without losing recent follow-up context.” |
| 7 | **Expose keep-warm cost.** `plugins/user-hud/hooks/cache.ts`, settings UI, README, tests. | Before auto keep-warm is enabled, the UI shows estimated cached tokens read per ping and the maximum for the idle stretch; automatic pings remain off by default. | “Show the estimated token cost of auto keep-warm using the last cached-prefix size; retain the current default.” |
| 8 | **Consolidate code-reference instructions.** `plugins/code-reference/hooks/format.ts`, `skills/reply-format/SKILL.md`, tests. | A review receives one authoritative format instruction; output still parses and renders; measure the injected input-token difference. | “Remove duplicated review-format guidance while preserving automatic review detection and linked output.” |
| 9 | **Avoid repeated PR reading.** Review guidance in the same files, plus tests or evaluation cases. | Begin from changed-file/hunk summaries; read full files only where needed; findings still cite verified current lines. Compare tokens and review quality on the same PRs. | “Tune PR review instructions for selective context loading and validate findings against a baseline.” |
| 10 | **Shorten exceptional resend paths.** `plugins/code-reference/hooks/format.ts`, `register.tsx`, `plugins/ask/hooks/answer.ts`, tests. | `/code-reference` after an unlinked reply requests a concise linked correction where feasible; sending an ask exchange lets the person choose a short excerpt/summary, while full send remains available. | “Reduce copied text in rewrite and send-to-chat flows without losing user control or meaning.” |

## Verification Plan

- **Focused checks:** Pure queue and prompt tests; `claude plugin validate plugins/user-hud`, `claude plugin test plugins/user-hud`, and corresponding checks for `ask` and `code-reference` when their slices change.
- **Integration checks:** On Claude Code 2.1.295 or the minimum supported version, create two agents in one turn, edit one task/model, refuse one, then use approve all during a later burst. Repeat with nested and plugin-started agents, a forked agent, interrupted turn, closed pane, and headless session. Confirm the launched agent's prompt and resolved model, not merely the pane label.
- **Layout checks:** Install next-steps alongside user-hud and test wide/narrow terminal, both load orders, next-steps absent, and desktop fallback. Verify next-steps still fills drafts and never submits them.
- **Token checks:** Record API input, cache-read, cache-write, and output totals for repeatable sample sessions before and after slices 6–10. Track `ask` fork usage and keep-warm pings separately. Treat user-hud's per-group allocation as an estimate, and verify review quality as well as lower token use.

## Risks and decisions

- **Approval safety:** A custom pane cannot be assumed to suspend a hook safely. The first slice must establish a supported wait path. If it cannot, use the documented `$.ui.ask` gate and keep the pane as a preview, or defer the feature; do not approximate approval with a timeout that launches the agent.
- **Model truthfulness:** An omitted model can resolve from the agent definition. Forks ignore model overrides. Show an unresolved/inherited state or require an explicit model selection rather than displaying a guessed model.
- **Batch scope:** Approve all is turn-scoped, visible, and never persists across turns or sessions. This avoids unintentionally approving future delegations.
- **Third-party layout:** Both mods currently append their `AbovePrompt` content after `next(e)`, so render order affects stacking. Side-by-side composition must be proven with public APIs; no dependency on next-steps internals.
- **Token quality:** Shorter prompts can worsen answers or reviews. Keep a small baseline set of real tasks and compare correctness, line links, and useful findings alongside token totals.

## Recommended Execution Order

1. Prove the approval gate and UI wait behavior (slice 1).
2. Build the queue, pane, batch control, and setting (slices 2–4).
3. Resolve layout coexistence with next-steps (slice 5).
4. Apply the five token improvements separately, in measured order (slices 6–10).
