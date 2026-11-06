---
name: update-mods
description: Update every installed polar-mods mod (user-hud, ask, delegator, code-reference) to the latest version on GitHub by running the mods installer from hyperbola-bear/claude-mods. Run by hand only, as /user-hud:update-mods; add "list" to only show versions, or "dry" to only show the commands.
argument-hint: "[list | dry]"
disable-model-invocation: true
allowed-tools: Bash(python3 <(curl -fsSL https://raw.githubusercontent.com/hyperbola-bear/claude-mods/main/mods)*)
---

# Update the mods

Run the mods installer from the main branch of `hyperbola-bear/claude-mods` with the Bash tool, exactly as written below and with nothing else in the command. Don't open the interactive checklist that plain `mods` shows, because it needs a terminal the Bash tool doesn't have.

Pick the flag from `$ARGUMENTS`:

- Empty, or anything other than the two words below: `--update`, which updates every mod that is installed and asks nothing.
- `list`: `--list`, which shows each mod, the version installed and the latest one, and changes nothing.
- `dry`: `--update --dry-run`, which shows the `claude plugin` commands it would run and runs none.

```sh
python3 <(curl -fsSL https://raw.githubusercontent.com/hyperbola-bear/claude-mods/main/mods) --update
```

Give the Bash call a timeout of 300000 ms, because refreshing the marketplace and reinstalling can take a minute or two.

Then report in two or three lines:

- Each mod that changed, as `name old → new`. If it printed `Every mod you have is up to date.`, say that.
- Anything it says is no longer offered or overlaps with another plugin, quoted as it printed it.
- If anything was updated: the updates load in a new Claude Code session, or after `/reload-plugins` in this one.

If the command fails (no network, `claude` not on the PATH, or a mod that would not update), quote the error lines it printed and stop. Don't retry, and don't run other `claude plugin` commands to work around it.

To add or remove mods, or to switch user-hud's modules, the person runs the checklist themself in a terminal:

```sh
python3 <(curl -fsSL https://raw.githubusercontent.com/hyperbola-bear/claude-mods/main/mods)
```
