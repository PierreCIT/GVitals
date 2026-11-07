#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
glib-compile-schemas --strict schemas/
GSETTINGS_BACKEND=memory GSETTINGS_SCHEMA_DIR="$PWD/schemas" gjs -m tests/run.js
GSETTINGS_BACKEND=memory GSETTINGS_SCHEMA_DIR="$PWD/schemas" gjs -m tests/values.js
GSETTINGS_BACKEND=memory GSETTINGS_SCHEMA_DIR="$PWD/schemas" gjs -m tests/gpu.js
