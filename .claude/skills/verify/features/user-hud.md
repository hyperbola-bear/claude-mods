# user-hud

A control panel above the prompt. Closed, it is one row at the right edge that sheds pieces as it narrows, ending at Clawd's face. Open, it is cards in one to three columns: other sessions, the context battery, model and effort, the cache countdown, guesses to check, next steps and handoff. Seven modules switch its parts on and off.

## Sub-features

- `hud-closed` sheds pieces in priority order down to the face `▐▛▜▌`.
- `hud-cards` lays the open panel in 1, 2 or 3 columns by width, and folds every card to one row when rows are short.
- `hud-more` shows `+N more` when even folded cards don't fit, and brings the hidden ones first when pressed.
- `hud-settings` turns the panel to the settings and back (`s`).
- `hud-face` turns the face's eyes yellow while another session needs you.
- `hud-pie` drains the countdown's pie `● ◕ ◑ ◔ ○` as the cache life runs out.
- `hud-battery` draws the context as ten cells, green to 50%, yellow to 75%, red beyond.
- `hud-sessions` counts and lists other sessions, and the Sessions pane lists them all (`e`, `z`).
- `hud-guesses` shows the guesses Claude reports through its `assumption` tool; `✓` clears one, `✗` fills the prompt box.
- `hud-pickers` runs `/model` and `/effort` from the model card; `/hud-styles` draws Rail, Ladder and Meter.
- `hud-modules` switches each module with `/hud <module> on|off`.
- `hud-tokens`, `hud-cache`, `hud-next`, `hud-handoff`: the Tokens pane (`t`, `/tokens`), Keep warm (`w`, `/keepwarm`), next steps (`1` to `3`), Write and Read handoff (`h`, `r`).

## How to get to it (user POV)

- Look at the corner above the prompt: the closed row is always there while a module is on.
- Click the tab, or type `/hud`, to open and close the panel.
- With the band focused: `s`, `e`, `a`, `t`, `w`, `h`, `r`, `1` to `3`, the arrow keys and Return.
- Type `/hud modules`, `/hud <module> on|off`, `/tokens`, `/cache`, `/keepwarm`, `/read-handoff`, `/hud-styles`.

## Driving it with tui.sh

Preconditions:

- `tui.sh start hud 120 40` is ready and the doctor passed (`/hud modules` lists `sessions` and `assume`).
- At least one other Claude Code session is running on this machine, so the sessions card has something to show. The person's own sessions count; never start or stop theirs.

- **Closed row.** Run `tui.sh sweep hud closed 48 80 120 160`. At 48 the row keeps `● N needs you` (when one waits) and the face. At 80 and up it adds the session counts and the model. No row is wider than the window, and none starts mid-word on the left.
- **Face.** With a session waiting (`● 1 needs you` on the row), the `.ansi` capture shows the warning colour behind `▛` and `▜`. With none waiting, those cells have Claude's orange behind them.
- **Open.** Run `tui.sh type hud "/hud"`. The screen shows `user-hud panel open.` and the cards, with `⚙ s: Settings` and `▐▛▜▌ user-hud ▾` on the bottom row.
- **Columns.** Run `tui.sh sweep hud open 160 100 60`. Two columns of cards at 100 and 160 (`── S E S S I O N S …` and `── C O N T E X T …` on one row), one column at 60.
- **Short band.** Run `tui.sh resize hud 100 24`, then `tui.sh shot hud open-short`. Every card is one row (`SESSIONS … asleep`, `CONTEXT ▕…▏`), the band no taller than before the prompt.
- **Pickers in cards.** Rail is the default style. Run `tui.sh sweep hud open 160 120 100 80`. Each capture shows a model row of `Haiku … Fable` over a `▔` bar, not the Ladder's `▄` strips. Two-column cards of about 49 cells keep the versions (`Haiku 4.5`). Narrower cards drop them (`Haiku`) and shorten the effort labels, `Ultra` first and then `Med`. For Meter, start a second session with `--settings '{"pluginConfigs":{"user-hud@inline":{"options":{"selectorStyle":"meter"}}}}'`, which changes no saved setting, and sweep again: the bars use `▁` to `▇`.
- **Settings.** Focus the band and run `tui.sh keys hud s`. The settings rows show and the bar reads `⚙ s: Back`. Press `s` again to return.
- **Sessions pane.** With the band focused, run `tui.sh keys hud e`. A pane titled `Sessions` lists NEEDS YOU, WORKING, DONE, ASLEEP and THIS SESSION, each title at most 30 characters.
- **Guesses.** Send a prompt that forces a choice, such as `tui.sh type hud "rename the main branch to trunk in a repo you pick"`. If Claude calls the `assumption` tool, the closed row shows `? N to check` and the card lists the guesses. Press `✗` on one (click its cells, or arrow to it and Return): the prompt box holds `Not quite: "<guess>". `. Clear the box before the next step.
- **Module off.** Run `tui.sh type hud "/hud sessions off"`, then sweep. The sessions card and the session pieces of the closed row are gone. Turn it back on with `/hud sessions on`.
- **Proof.** Keep the sweep captures. For the face and the battery, keep the `.ansi` files, which carry the colours.

On the desktop, run the same steps through computer use in a Code session of this checkout. The band there has 12 rows, so the cards are folded unless one was brought to the front. Compare each row's text with the terminal capture at the matching width.

## Gotchas

- Nothing is counted before the session's first request: the context card reads `known after a reply` and the pickers have no effort highlight yet. Send one short prompt before proving those.
- The terminal draws the band only in the area the app gives it, a few columns narrower than the window. With a docked pane (filetree, delegator) beside the transcript, it is narrower still. To keep filetree's pane out, start with `tui.sh start hud 160 50 --settings '{"enabledPlugins":{"filetree@claude-code-filetree":false}}'`.
- The panel remembers whether it was open. If `/hud` answers `user-hud panel closed.`, type it again.
- On a short band every card folds to one row, so a full card (the pickers, the guesses) needs a tall window: `tui.sh resize hud 70 90`.
- Sessions refresh every 5 seconds and titles once a minute. Wait for the next refresh before asserting a change.
- A waiting session in the person's list may be days old. It is real data; don't try to answer it.
- `[-]` at the band's right end is Claude Code's own collapse control, not the plugin's.
