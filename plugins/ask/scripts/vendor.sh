#!/bin/sh
# Rebuilds hooks/vendor/beautiful-mermaid.js: one ES module with no imports
# (a hooks module imports only files of its own plugin, each under 1 MB), with
# elkjs swapped for scripts/elk-stub.js. Box drawings need no ELK; SVG for
# flowcharts and state, class and ER diagrams does, so those throw here.
set -eu
VERSION=${1:-1.1.3}
HERE=$(cd "$(dirname "$0")/.." && pwd)
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
cd "$WORK"
npm init -y >/dev/null
npm install --ignore-scripts --no-audit --no-fund "beautiful-mermaid@$VERSION" esbuild@0.25.10 >/dev/null
./node_modules/.bin/esbuild node_modules/beautiful-mermaid/dist/index.js --bundle --format=esm \
  --platform=neutral --minify --legal-comments=eof --log-level=warning \
  --alias:elkjs/lib/elk.bundled.js="$HERE/scripts/elk-stub.js" --outfile=out.js
ENT=$(node -p "require('./node_modules/entities/package.json').version")
{
  printf '// beautiful-mermaid %s (MIT, Craft Docs) bundled with entities %s (BSD-2-Clause); elkjs left out (scripts/elk-stub.js).\n' "$VERSION" "$ENT"
  printf '// by scripts/vendor.sh (esbuild --bundle --format=esm --platform=neutral --minify). Licenses: ./LICENSES.md. Do not edit.\n'
  cat out.js
} >"$HERE/hooks/vendor/beautiful-mermaid.js"
echo "wrote hooks/vendor/beautiful-mermaid.js (beautiful-mermaid $VERSION, entities $ENT, no elkjs)"
