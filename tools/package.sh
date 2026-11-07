#!/bin/sh
# Create the same extension bundle locally and in CI.
set -eu
if [ "$#" -ne 1 ]; then
    echo "Usage: $0 /absolute/path/to/gvitals.zip" >&2
    exit 2
fi
case "$1" in
    /*) output=$1 ;;
    *) echo "The output path must be absolute" >&2; exit 2 ;;
esac
cd "$(dirname "$0")/.."
if [ -e "$output" ]; then
    echo "Output already exists: $output" >&2
    exit 1
fi
zip -q -r "$output" ./*.js metadata.json prefs.ui stylesheet.css helpers icons locale schemas \
    -x 'locale/*.po' 'locale/*/LC_MESSAGES/*.po' 'locale/vitals.pot' 'schemas/gschemas.compiled'
