#!/usr/bin/env bash
# usage: measure-run.sh rw|pw <label> <node script>
# Times the whole run (including browser children) and samples peak RSS.
set -u
kind="$1"; label="$2"; script="$3"
out=".scratch/spine-engine/test-speed/proto/${label}"
export RW_PROFILE="/tmp/opencode/rw-profile-$$"
if [[ "$kind" == "rw" ]]; then
  baseline=$(ps -eo rss,args --no-headers | grep -E "chrome-linux64/chrome" | grep -v grep | awk '{r+=$1} END{print r+0}')
  pattern="chrome-linux64/chrome"
else
  baseline=$(ps -eo rss,args --no-headers | grep -E "chrome-headless-shell" | grep -v grep | awk '{r+=$1} END{print r+0}')
  pattern="chrome-headless-shell"
fi
case "$script" in
  *.py) runner="./.scratch/spine-engine/test-speed/.venv/bin/python" ;;
  *) runner="node" ;;
esac
: > "$out.sample"
(
  while true; do
    rss=$(ps -eo rss,args --no-headers | grep -E "$pattern" | grep -v grep | awk '{r+=$1} END{print r+0}')
    echo "$rss" >> "$out.sample"
    sleep 0.05
  done
) &
sampler=$!
TIMEFORMAT='real=%3R user=%3U sys=%3S'
{ time $runner "$script" > "$out.log" 2>&1 ; } 2> "$out.time"
status=$?
kill "$sampler" 2>/dev/null
peak=$(awk '{if($1>m)m=$1} END{print m+0}' "$out.sample")
echo "STATUS=$status"
cat "$out.time"
echo "peak_rss_kb=$peak baseline_kb=$baseline delta_mb=$(( (peak-baseline)/1024 ))"
tail -n +1 "$out.log"
