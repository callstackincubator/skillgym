#!/bin/sh
set -eu

marker="${1:-missing-marker}"

cat > bootstrap-output.txt <<EOF
Bootstrap marker: ${marker}
EOF
