#!/bin/sh

set -eu

marker="${1:-demo}"

printf 'Bootstrap marker: %s\n' "$marker" > bootstrap-output.txt
