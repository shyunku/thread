#!/usr/bin/env bash
# Runs a command and, if it fails, puts the end of its output in an error
# annotation (readable without signing in, unlike the job log).
# usage: logged.sh <title> <command...>
title="$1"; shift
log="$(mktemp)"
set -o pipefail
if "$@" > "$log" 2>&1; then
  tail -n 40 "$log"
  exit 0
fi
status=$?
tail -n 200 "$log"
# Keep the lines that explain the failure, then the tail.
summary="$( (grep -E 'error|Error|ERROR|failed|\[!\]' "$log" | tail -n 40; echo '----'; tail -n 40 "$log") | sed 's/%/%25/g; s/\r//g' | awk '{printf "%s%%0A", $0}')"
echo "::error title=${title}::${summary}"
exit $status
