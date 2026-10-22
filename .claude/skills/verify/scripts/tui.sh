#!/bin/sh
# Drives Claude Code in a detached tmux session with this checkout's plugins loaded, and captures what it draws.
#
#   tui.sh start  <name> <cols> <rows> [args]     launch, wait until the band draws; args go to claude
#   tui.sh keys   <name> <tmux key>...             send keys (tmux send-keys syntax: "/hud" Enter)
#   tui.sh type   <name> <text>                    type text literally, then Enter
#   tui.sh resize <name> <cols> <rows>
#   tui.sh shot   <name> <label>                   save <label>.txt and <label>.ansi
#   tui.sh sweep  <name> <label> <cols>...         resize to each width, settle, shot <label>-<cols>, report overwide rows
#   tui.sh wait   <name> <text> [seconds]          wait until the screen shows text
#   tui.sh stop   <name>                           kill only the tmux session this script started
#
# Evidence goes to $VERIFY_OUT (default ~/.cache/polar-mods-verify/<date>) and survives stop.
set -eu

ROOT=$(cd "$(dirname "$0")/../../../.." && pwd)
OUT=${VERIFY_OUT:-"$HOME/.cache/polar-mods-verify/$(date +%Y%m%d-%H%M%S)"}
SOCK=polar-verify
CONF=$(cd "$(dirname "$0")" && pwd)/tmux.conf

need() { command -v "$1" >/dev/null 2>&1 || { echo "tui.sh: $1 is not installed ($2)" >&2; exit 2; }; }
need tmux "brew install tmux"
need claude "install Claude Code 2.1.287 or later"

tm() { tmux -L "$SOCK" -f "$CONF" "$@"; }
screen() { tm capture-pane -p -t "$1"; }

wait_for() {
  _w_name=$1 _w_text=$2 _w_secs=${3:-45}
  _w_i=0
  while [ "$_w_i" -lt "$_w_secs" ]; do
    if screen "$_w_name" | grep -q -- "$_w_text"; then return 0; fi
    sleep 1
    _w_i=$((_w_i + 1))
  done
  echo "tui.sh: '$_w_text' did not show within ${_w_secs}s; last screen:" >&2
  screen "$_w_name" >&2
  return 1
}

# Rows of a capture wider than its window, counted in characters: box-drawing glyphs are three bytes each.
fits() {
  _f_n=0 _f_bad=""
  while IFS= read -r _f_l || [ -n "$_f_l" ]; do
    _f_n=$((_f_n + 1))
    _f_w=$(printf '%s' "$_f_l" | LC_ALL=en_US.UTF-8 wc -m | tr -d ' ')
    [ "$_f_w" -gt "$2" ] && _f_bad="$_f_bad row $_f_n ($_f_w)"
  done <"$1"
  if [ -z "$_f_bad" ]; then echo "  fits in $2 columns"; else echo "  wider than $2 columns:$_f_bad"; fi
}

shot() {
  _s_dir="$OUT/$1"
  mkdir -p "$_s_dir"
  tm capture-pane -p -t "$1" >"$_s_dir/$2.txt"
  tm capture-pane -p -e -t "$1" >"$_s_dir/$2.ansi"
  echo "$_s_dir/$2.txt"
}

cmd=${1:-}
[ -n "$cmd" ] || { sed -n '2,13p' "$0"; exit 2; }
shift

case "$cmd" in
  start)
    name=$1 cols=$2 rows=$3
    shift 3
    dirs=""
    for p in "$ROOT"/plugins/*/; do dirs="$dirs --plugin-dir $p"; done
    # The installed polar-mods copies are switched off for this session only, so the checkout's code is what draws.
    off='{"enabledPlugins":{"user-hud@polar-mods":false,"delegator@polar-mods":false,"ask@polar-mods":false,"code-reference@polar-mods":false}}'
    # shellcheck disable=SC2086
    tm new-session -d -s "$name" -x "$cols" -y "$rows" -c "$ROOT" claude --settings "$off" $dirs "$@"
    # A folder Claude Code hasn't opened before asks to be trusted first. This is the checkout being verified, so say yes.
    i=0
    while [ "$i" -lt 20 ]; do
      if screen "$name" | grep -q "Yes, I trust this folder"; then
        tm send-keys -t "$name" Down Enter
        echo "answered the trust prompt for $ROOT"
        break
      fi
      if screen "$name" | grep -q "user-hud"; then break; fi
      sleep 1
      i=$((i + 1))
    done
    wait_for "$name" "user-hud" 60
    mkdir -p "$OUT/$name"
    echo "started $name at ${cols}x${rows}; evidence in $OUT/$name"
    ;;
  keys) name=$1; shift; tm send-keys -t "$name" "$@" ;;
  type) name=$1; tm send-keys -t "$name" -l "$2"; tm send-keys -t "$name" Enter ;;
  resize) tm resize-window -t "$1" -x "$2" -y "$3" ;;
  shot) shot "$1" "$2" ;;
  sweep)
    name=$1 label=$2
    shift 2
    rows=$(tm display-message -p -t "$name" '#{window_height}')
    for c in "$@"; do
      tm resize-window -t "$name" -x "$c" -y "$rows"
      sleep 1.5
      shot "$name" "$label-$c"
      fits "$OUT/$name/$label-$c.txt" "$c"
    done
    ;;
  wait) wait_for "$@" ;;
  stop) tm kill-session -t "$1" 2>/dev/null || true ;;
  *) echo "tui.sh: unknown command $cmd" >&2; exit 2 ;;
esac
