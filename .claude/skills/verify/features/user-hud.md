# user-hud

A control panel above the prompt. Closed, it is one row at the right edge that sheds pieces as it narrows, ending at the tab's four diamonds `❖`. Open, it is cards down one to three columns, in this order: model and effort, the cache countdown, the context battery, other sessions, guesses to check, next steps and handoff. Seven modules switch its parts on and off.

## Sub-features

- `hud-closed` sheds pieces in priority order down to the mark `❖`.
- `hud-cards` lays the open panel as tiles of one size, 1, 2 or 3 across by width, in rows that line up, handoff in the bottom bar; short of rows, whole rows of tiles fold to one row a tile from the last up.
- `hud-more` shows `+N more` when even folded cards don't fit, and brings the hidden ones first when pressed.
- `hud-settings` turns the panel to the settings and back (`s`).
- `hud-mark` turns the four diamonds yellow while another session needs you.
- `hud-pie` drains the countdown's pie `● ◕ ◑ ◔ ○` as the cache life runs out.
- `hud-battery` draws the context as ten cells, green to 50%, yellow to 75%, red beyond.
- `hud-sessions` counts and lists other sessions, and the Sessions pane lists them all (`e`, `z`).
- `hud-session-jump`: pressing another session's row, on the card or in the Sessions pane, brings forward where it runs: the Claude desktop app on it; the exact tab in Orca, Terminal, iTerm2, Ghostty and tmux; the project's window in VS Code, Cursor and the JetBrains IDEs; any other app as a whole.
- `hud-settings-save`: every panel setting saves on both surfaces: through `$.config.set` in the terminal, through `claude plugin configure` on the desktop, whose engine lists no `/config` rows for plugins.
- `hud-last-row`: the last row of the band and of every pane is whole on the desktop.
- `hud-modules`: the Modules pane switches each module and moves its card a place at a time (`/hud modules`, `/hud order`; `d` for the usual order). Settings → Modules shows the same rows in the panel, in place of the settings, with `s: Back`; too short for them, one pill a module.
- `hud-guesses` shows the guesses Claude reports through its `assumption` tool; `✓` clears one, `✗` fills the prompt box.
- `hud-pickers` runs `/model` and `/effort` from the model card; `/hud-styles` draws Rail, Ladder and Meter.
- `hud-modules` switches each module with `/hud <module> on|off`.
- `hud-order` reorders the cards with `/hud order <modules…>` (or **Module order** in `/config`).
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

- **Closed row.** Run `tui.sh sweep hud closed 48 80 120 160`. At 48 the row keeps `● N needs you` (when one waits) and the mark. At 80 and up it adds the session counts and the model. No row is wider than the window, and none starts mid-word on the left.
- **Mark.** With a session waiting (`● 1 needs you` on the row), the `.ansi` capture draws `❖` in the warning colour. With none waiting, it is cream. Either way its ground is Claude's orange.
- **Open.** Run `tui.sh type hud "/hud"`. The screen shows `user-hud panel open.` and the cards, with `⚙ s: Settings` and `❖ user-hud ▾` on the bottom row.
- **Columns.** Run `tui.sh sweep hud open 160 100 60`. Two tiles a row at 100, three at 160, one at 60. The first row starts `── M O D E L` with `── C A C H E` beside it (and `── C O N T E X T` at 160); every tile in a row has the same height, and the bottom bar reads `⚙ s: Settings   ✦ h: Write handoff …`.
- **Short band.** Run `tui.sh resize hud 100 24`, then `tui.sh shot hud open-short`. The model and effort pickers stay in full (`── M O D E L`); the other rows fold from the last up (`? N to check`, `SESSIONS … asleep`), then go behind `+N more`, the band no taller than before the prompt.
- **Pickers in cards.** Rail is the default style. Run `tui.sh sweep hud open 160 120 100 80`. Each capture shows a model row of `Haiku … Fable` over a `▔` bar, not the Ladder's `▄` strips. Two-column cards of about 49 cells keep the versions (`Haiku 4.5`). Narrower cards drop them (`Haiku`) and shorten the effort labels, `Ultra` first and then `Med`. For Meter, start a second session with `--settings '{"pluginConfigs":{"user-hud@inline":{"options":{"selectorStyle":"meter"}}}}'`, which changes no saved setting, and sweep again: the bars use `▁` to `▇`.
- **Settings.** Focus the band and run `tui.sh keys hud s`. The settings rows show and the bar reads `⚙ s: Back`. Press `s` again to return.
- **Sessions pane.** With the band focused, run `tui.sh keys hud e`. A pane titled `Sessions` lists NEEDS YOU, WORKING, DONE, ASLEEP and THIS SESSION, each title at most 30 characters.
- **Jump to a session.** In the Sessions pane, arrow to a row marked `app` and press Return (or click it). The desktop app comes forward on that session: `get_window_layout` names its `local_…` id in the focused pane. Switch back with `open "claude://code/continue?session=<this session's local_ id>"`.
- **Jump to a terminal session.** Start test sessions with `--model claude-sonnet-5-5`, each in its own folder, from a clean environment: an app this session launches inherits `CLAUDE_CODE_CHILD_SESSION` and its sessions write no status file. So start a closed app with `env -i HOME=$HOME USER=$USER PATH=/usr/bin:/bin open -a <App>`. In tmux, click a row with an SGR mouse report: `tmux -L polar-verify send-keys -t hud -l $'\e[<0;<col>;<row>M\e[<0;<col>;<row>m'`, at the row's place in the last capture. Put Finder in front first, then check `lsappinfo front` and:
  - Terminal: `osascript -e 'tell application "Terminal" to get tty of selected tab of front window'` is the session's tty (`ps -o tty= -p <pid>`), also for two sessions in one folder.
  - Ghostty: `working directory of focused terminal of selected tab of front window` is the session's folder.
  - Orca: with another tab of the workspace selected first (`orca terminal switch`), the session's tab is selected after.
  - tmux (`tmux -L jt new-session …; attach` in a Terminal window): `display-message -p '#{window_index}'` moves to the session's window, and Terminal comes forward on the client's tty.
  - VS Code: two workspace windows, the other one main before; the session's window is main after (`app_list_windows`). It needs the session's `CLAUDE_CODE_SSE_PORT` (the extension's); without it only the app comes forward.
  - GoLand: computer use cannot click inside GoLand, so run Claude in tmux from a Shell Script run configuration (`/opt/homebrew/bin/tmux -L gl new-session -A -s goland-a 'claude --model claude-sonnet-5-5'`, run in the terminal), `tmux -L gl set -g window-size manual` and `resize-window -y 45` so the band shows, and click through `tmux -L gl send-keys`. After a row's click `idea.log` says `Reusing already opened project <root>`, and a capture of the title bar (`screencapture -R`) shows that project's window in front and active. The log alone proves nothing: the IDE's `goland://open?file=` URL logs the same line and raises no window. Never test with `open -b com.jetbrains.goland <open project>`: that loads the project twice and leaves an empty window that answers no clicks.
- **Guesses.** Send a prompt that forces a choice, such as `tui.sh type hud "rename the main branch to trunk in a repo you pick"`. If Claude calls the `assumption` tool, the closed row shows `? N to check` and the card lists the guesses. Press `✗` on one (click its cells, or arrow to it and Return): the prompt box holds `Not quite: "<guess>". `. Clear the box before the next step.
- **Modules pane.** Run `tui.sh type hud "/hud modules"`. A pane titled `Modules` lists the six cards numbered 1 to 6, each with `● on` and `▲   ▼`, then Handoff with `bottom bar`. Click `▲` on Sessions: it becomes 3, the header gains `d: usual order`, and the open panel's cards follow. Click `● on` on Context: it reads `○ off` and the CONTEXT card leaves the panel. Press `d`, and `/hud tokens on`, to put both back. This writes `user-hud.moduleOrder` and `user-hud.tokensModule`, so snapshot `~/.claude/settings.json` first.
- **Order.** Run `tui.sh type hud "/hud order next sessions"`. It answers `Cards top to bottom: next, sessions, pickers, …`, and the open panel's first card is `── N E X T   S T E P S`. Put it back with `/hud order pickers`.
- **Module off.** Run `tui.sh type hud "/hud sessions off"`, then sweep. The sessions card and the session pieces of the closed row are gone. Turn it back on with `/hud sessions on`.
- **Proof.** Keep the sweep captures. For the mark and the battery, keep the `.ansi` files, which carry the colours.

On the desktop, the person runs the same steps in a Code session of this checkout (computer use cannot control the Claude app). The band there has 12 rows, so the cards are folded unless one was brought to the front. Compare each row's text with the terminal capture at the matching width.

- **Settings save on the desktop engine, by an agent.** Run `use-source.sh`, and copy `~/.claude/settings.json` aside. Start the engine in `~/Library/Application Support/Claude/claude-code/<version>/<build>/claude.app/Contents/MacOS/claude` with `--output-format stream-json --verbose --input-format stream-json --no-session-persistence --setting-sources=user,project,local`, and pipe it these messages 7 seconds apart, each `{"type":"user","message":{"role":"user","content":"<command>"}}`: `/hud pickers off`, `/hud pickers on`. Use a module that already has a saved value, so putting it back leaves the file as it was. After each one, `pluginConfigs["user-hud@polar-mods"].options.pickersModule` has flipped, and the `result` line reads `user-hud: The pickers module is off.` or `on.`. Local commands cost no model call. The same works for `/delegator on`, `/delegator off`.
- **Settings save on the desktop, by the person.** Copy `~/.claude/settings.json` aside first. In a desktop Code session of this checkout, click the band, press `s`, click **Auto keep-warm**. It flips to `● On` with no toast, and `pluginConfigs["user-hud@polar-mods"].options.autoKeepWarm` is `true` in `~/.claude/settings.json`. Click it again to put it back. Repeat with **Picker style** and a switch in **Modules**: each one holds, and `/hud` keeps it after `/reload-plugins`. A toast reading `no /config row` means the fallback did not run.
- **Last row on the desktop.** Open the panel and the Sessions pane (`e`). Zoom on the bottom row of each: `Settings`, the `user-hud` tab and the last session's title keep their tails (`g`, `p`, `y`). Then the same in the Tokens pane (`t`) and the Modules pane.

## Gotchas

- Nothing is counted before the session's first request: the context card reads `known after a reply` and the pickers have no effort highlight yet. Send one short prompt before proving those.
- The terminal draws the band only in the area the app gives it, a few columns narrower than the window. With a docked pane (filetree, delegator) beside the transcript, it is narrower still. To keep filetree's pane out, start with `tui.sh start hud 160 50 --settings '{"enabledPlugins":{"filetree@claude-code-filetree":false}}'`.
- The panel remembers whether it was open. If `/hud` answers `user-hud panel closed.`, type it again.
- On a short band every card folds to one row, so a full card (the pickers, the guesses) needs a tall window: `tui.sh resize hud 70 90`.
- Sessions refresh every 5 seconds and titles once a minute. Wait for the next refresh before asserting a change.
- A waiting session in the person's list may be days old. It is real data; don't try to answer it.
- `[-]` at the band's right end is Claude Code's own collapse control, not the plugin's.
- A desktop session's `$.config.list()` has no plugin rows at all, so `$.config.set` fails there whatever the key. A terminal session cannot show this: compare the two surfaces before you trust a settings proof from one.
- `tui.sh` loads the plugins as `<name>@inline`, and `claude plugin configure` cannot reach an inline plugin. The desktop's fallback only proves itself with `use-source.sh` run, under the real `user-hud@polar-mods` id.
- To see what the desktop gets without its UI, act as its host: on the stream-json recipe, send control requests `ui_attach` (`surface: "desktop"`, a `client_id`) and `ui_render` (`component: "AbovePrompt"`, `instance_id`, and `props` with `hasSurvey`, `isWorking`, `maxRows`, `bodyColumns`, `scroll`, `view`). A band the engine answers can still fail to show: the Code tab's own code decides what it mounts, and the desktop always sends `hasSurvey: false`.
- The Code tab removes every plugin's band while a next-step card is waiting, unless the keyboard focus is inside the band (`turnCardShown` in its band wrapper). That is the app's own rule, not a mod bug, and a reload changes nothing. Before you report a missing band on the desktop, check that no card is up. An agent that ends its turn with a question puts one up itself.
