#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
glib-compile-schemas --strict schemas/
test_tmp_dir=$(mktemp -d)
trap 'rm -rf "$test_tmp_dir"' EXIT HUP INT TERM
glib-compile-resources --sourcedir=tests/fixtures --target="$test_tmp_dir/prefs.gresource" tests/fixtures/prefs.gresource.xml
GSETTINGS_BACKEND=memory GSETTINGS_SCHEMA_DIR="$PWD/schemas" GVITALS_TEST_PREFS_RESOURCE="$test_tmp_dir/prefs.gresource" \
    gjs -m tests/preferences.js
