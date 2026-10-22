#!/bin/sh
# Points the installed polar-mods at a source, keeping which mods are installed and their saved options.
#
#   use-source.sh            read the mods from this checkout; edits reach a session through /reload-plugins
#   use-source.sh --github   read them from hyperbola-bear/claude-mods again
set -eu

ROOT=$(cd "$(dirname "$0")/../../../.." && pwd)
SRC=$ROOT
[ "${1:-}" = "--github" ] && SRC=hyperbola-bear/claude-mods
SETTINGS=${CLAUDE_CONFIG_DIR:-$HOME/.claude}/settings.json

# Removing a marketplace uninstalls its plugins and deletes their saved options, so both are read first.
kept=$(python3 -I - "$SETTINGS" <<'EOF'
import json, sys
d = json.load(open(sys.argv[1]))
mods = [k for k, on in d.get('enabledPlugins', {}).items() if k.endswith('@polar-mods') and on]
opts = {k: v for k, v in d.get('pluginConfigs', {}).items() if k.endswith('@polar-mods')}
print(json.dumps({'mods': mods, 'opts': opts}))
EOF
)

claude plugin marketplace remove polar-mods >/dev/null
claude plugin marketplace add "$SRC" >/dev/null
for id in $(printf '%s' "$kept" | python3 -I -c 'import json,sys; print(" ".join(json.load(sys.stdin)["mods"]))'); do
  claude plugin install "$id" >/dev/null
done

printf '%s' "$kept" | python3 -I -c '
import json, sys
p = sys.argv[1]
kept = json.load(sys.stdin)
d = json.load(open(p))
d.setdefault("pluginConfigs", {}).update(kept["opts"])
with open(p, "w") as f:
    json.dump(d, f, indent=2)
    f.write("\n")
' "$SETTINGS"

claude plugin list 2>/dev/null | grep -A2 '@polar-mods' | grep -E '❯|Version|Read from|Source' || true
