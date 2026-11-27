#!/usr/bin/env bash
# usage: sample.sh <outfile> &  ; samples playwright chrome + node RSS and CPU
out="$1"
peak_rss=0
peak_cpu=0
: > "$out"
while true; do
  read -r rss cpu < <(
    ps -eo rss,pcpu,args --no-headers \
      | grep -E "ms-playwright|playwright" | grep -v grep \
      | awk '{r+=$1; c+=$2} END {printf "%d %d\n", r, c}'
  )
  [ "${rss:-0}" -gt "$peak_rss" ] && peak_rss=$rss
  [ "${cpu:-0}" -gt "$peak_cpu" ] && peak_cpu=$cpu
  printf '%s %s %s\n' "$(date +%s%3N)" "$peak_rss" "$peak_cpu" >> "$out"
  sleep 0.2
done
