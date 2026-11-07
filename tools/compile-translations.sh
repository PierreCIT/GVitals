#!/bin/sh
# Compile gettext catalogs from their distributable source files.
set -eu
cd "$(dirname "$0")/.."
for po in locale/*/LC_MESSAGES/vitals.po; do
    msgfmt --check --output-file="${po%.po}.mo" "$po"
done
