---
name: verify
description: "Drive and verify the polar-mods Claude Code mods (user-hud, delegator, ask, code-reference) on both surfaces they draw on: the terminal, through tmux, and the Claude desktop app, through computer use. Use after any change to a mod and before calling it done, to prove it behaves and draws the same cells in the terminal and the desktop at every width."
---

# Verify polar-mods

Every mod here draws one grid of cells in a `Client` region, so the terminal and the desktop app show the same rows. Verifying a change means proving that on both surfaces, at the widths people use, not only in tests.

A change is verified only when all five hold:

1. `claude plugin validate plugins/<mod>` is clean.
2. `claude plugin test plugins/<mod>` passes, the surface-parity and width tests included.
3. The terminal sweep passes: the drawing at 48, 80, 120 and 160 columns, open and closed.
4. The desktop sweep passes: the same drawings narrow, medium and wide.
5. The two sweeps agree. Both surfaces draw the same text in each row at the same width.

## The drawing contract

Check every capture against these. Each one has a test in the plugins. A live failure means a test is missing, so write it before you fix the code.

- No row is wider than its region. A row that does not fit is cut and ends in `…`.
- Nothing is lost off the left edge. The band sits against the right edge, so an overwide row would lose its start.
- The band is never taller than the rows the surface gives it. The desktop gives 12.
- Colours are theme keys (`claude`, `success`, `warning`, `error`, `suggestion`, `subtle`) or the fixed hex sets the mods define (model ramp, effort ramp, battery, characters). Check each capture in a light and a dark theme.
- Glyphs come from Box Drawing, Block Elements, Geometric Shapes and the few marks the mods already use (`✦ ✓ ✗ ⚙ ◷ ▸ ▾ ▴`). No emoji: a fallback face draws them two cells wide and shifts the row.
- VS Code and mobile draw no `Client`. They get the same rows as text with plain buttons. Check that the fallback appears; it doesn't need to match.

## Launch

### Terminal

Needs tmux (`brew install tmux`) and Claude Code 2.1.287 or later. [`scripts/tui.sh`](scripts/tui.sh) starts Claude Code in a detached tmux session at a fixed size, with every folder under `plugins/` loaded through `--plugin-dir` and the installed polar-mods copies switched off for that session only:

```sh
.claude/skills/verify/scripts/tui.sh start hud 120 40
```

It is ready when it prints `started hud at 120x40`. That happens once the screen shows `user-hud`, the tab of the band. The first launch in a folder Claude Code hasn't opened asks whether to trust it; `start` answers yes for this checkout and prints `answered the trust prompt`. Its tmux server uses [`scripts/tmux.conf`](scripts/tmux.conf), so windows keep the size they are given. Give a session its own name per scenario; two runs never share one.

### Desktop

On a machine where computer use works. Once per machine, point the installed polar-mods at this checkout so desktop sessions read the plugins from it:

```sh
.claude/skills/verify/scripts/use-source.sh
```

Removing a marketplace uninstalls its plugins and deletes their saved options, so never switch the source by hand. [`scripts/use-source.sh`](scripts/use-source.sh) reads which polar-mods are on and their options first, switches the source, reinstalls those mods and puts the options back. This changes the person's setup, so ask before running it, and say how to undo it: `use-source.sh --github`. After that, edits reach a session through `/reload-plugins`, with no reinstall.

Each run: open the Claude desktop app, start a new Code session in this checkout, and type `/reload-plugins`.

## Doctor

Before driving, prove the instance runs this checkout's code.

- **Terminal:** `tui.sh type hud "/hud modules"`, then `tui.sh wait hud sessions`. The list names the `sessions` and `assume` modules, which only the checkout's user-hud has.
- **Desktop:** `claude plugin list` shows `Read from: <checkout>/plugins/<mod>` for each of the four. In the session, `/hud modules` lists `sessions` and `assume`.
- **Both:** `claude plugin validate plugins/<mod>` is clean. If a hook failed, the transcript has a dim line `<plugin>: <event> ... refused: <reason>`. Read it before guessing.

## Drive

Drive the way a person does: slash commands typed at the prompt, and keys pressed with the band or a pane focused. Never call a mod's internals.

### Terminal

```sh
S=.claude/skills/verify/scripts/tui.sh
$S type hud "/hud"                          # open the band's panel
$S shot hud open-120
$S sweep hud open 48 80 120 160             # open-48.txt … open-160.txt
$S type hud "/hud"                          # close it again
$S sweep hud closed 48 80 120 160
$S type hud "/hud sessions off"             # a module off, then the same sweep
```

Use `tui.sh keys <name> <key>` for keys inside the band or a pane (`Escape`, `Enter`, `Tab`, a letter). The terminal draws the band only when the window is at least as wide as the band needs; under 40 columns expect the closed row's tab alone.

### Desktop

Through computer use, with screenshots saved to disk:

- Type the same commands in the Code session's prompt.
- Change the width three ways: full window (wide), the window at half the screen (medium), and the session in split view beside another session (narrow, about a docked pane's width).
- Screenshot the band after each step, and each pane the step opens.
- Switch the app between light and dark once per sweep.

## Evidence

- Terminal captures go to `~/.cache/polar-mods-verify/<run>/<name>/<label>.txt` (plain) and `.ansi` (with colour). Set `VERIFY_OUT` to choose the folder.
- Under tmux, Claude Code draws 256 colours whatever `TERM` and `COLORTERM` say, so an `.ansi` capture holds each colour's nearest 256-colour match: the explorer's hat `#c9b07a` is `38;5;180`. It proves which cells get which colour, not the exact hex. The plugins' tests prove the hex values, and the desktop screenshots show them.
- `sweep` checks every capture against its width and prints `fits in <cols> columns` or the rows that are wider. It counts characters: box-drawing and block glyphs take three bytes each, so a byte count such as `awk length` flags rows that fit.
- Save desktop screenshots into the same run folder, named `desktop-<label>-<narrow|medium|wide>.png`.
- A proof shows the action and the state after it, not only the final screen. For a module switch, capture before and after.
- Check side effects alongside the drawing. A guess marked wrong fills the prompt box. A saved setting appears in `/config`. A pane the drawing claims is open is listed by the app.
- To compare surfaces, put each terminal `.txt` beside the desktop screenshot of the same width class. Every row's text must match. Colour can differ only where a theme key resolves differently in light and dark.

## Cleanup

- `tui.sh stop <name>` for each session you started. It kills only that tmux session, on its own tmux socket. Never kill `claude` by process name: the person's own sessions are running too.
- On the desktop, close the sessions you opened. Undo the marketplace change only if you made it for this run.
- Never delete the evidence folder. Name it in your report.

## Helpers

[`scripts/tui.sh`](scripts/tui.sh): `start <name> <cols> <rows> [claude args…]`, `type <name> <text>`, `keys <name> <keys…>`, `resize <name> <cols> <rows>`, `shot <name> <label>`, `sweep <name> <label> <cols…>`, `wait <name> <text> [seconds]`, `stop <name>`. Run it with no arguments for the same list.

[`scripts/use-source.sh`](scripts/use-source.sh): no argument reads the installed polar-mods from this checkout; `--github` reads them from `hyperbola-bear/claude-mods` again. Both keep which mods are installed and their saved options.

## The verification loop

1. Make the change.
2. Validate and test the plugin (steps 1 and 2 above). Fix until green.
3. Run the terminal sweep for every drawing the change touches, open and closed, with the changed module on and off.
4. Run the desktop sweep for the same drawings.
5. Compare the two against the drawing contract.
6. When a lane fails: add a test that fails the same way first. Width bugs belong in the plugin's width sweep test, surface differences in its parity test. Then fix the code and rerun from step 2.
7. Report each lane as pass or fail with its evidence paths. A lane you couldn't run is reported as not run, with the reason, never as a pass.

## Feature map

[`features/README.md`](features/README.md) lists every user-facing feature of the four mods, how a person reaches it, how to drive it on each surface, and the end state that proves it works. A proof that covers one entry point is incomplete when the map lists others.
