#!/usr/bin/env bash
# usage: run-measure.sh <label> <workers> <spec...>
set -u
label="$1"; workers="$2"; shift 2
out=".scratch/spine-engine/test-speed/${label}"
baseline=$(ps -eo rss,args --no-headers | grep -E "chrome-headless-shell" | grep -v grep | awk '{r+=$1} END{print r+0}')
./.scratch/spine-engine/test-speed/sample.sh "$out.sample" &
sampler=$!
TIMEFORMAT='real=%3R user=%3U sys=%3S'
{ time npx playwright test "$@" --workers="$workers" --reporter=line ; } > "$out.log" 2>&1
status=$?
kill "$sampler" 2>/dev/null
peak=$(awk '{if($2>m)m=$2} END{print m+0}' "$out.sample")
peakcpu=$(awk '{if($3>m)m=$3} END{print m+0}' "$out.sample")
tail -n 4 "$out.log"
printf 'STATUS %s | baseline_chrome_rss_kb=%s peak_chrome_rss_kb=%s delta_mb=%s peak_cpu_pct_sum=%s\n' \
  "$status" "$baseline" "$peak" "$(( (peak-baseline)/1024 ))" "$peakcpu"
