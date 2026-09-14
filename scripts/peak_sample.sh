#!/usr/bin/env bash
# Peak-hour sampler (read-only). Records host + container + DB activity snapshots.
#
# Usage:
#   sudo bash peak_sample.sh [interval_sec] [iterations] [output_file]
# Examples:
#   sudo bash peak_sample.sh                 # 60s interval, 60 iterations (= 1 hour)
#   sudo bash peak_sample.sh 30 240          # every 30s for 2 hours
#   sudo bash peak_sample.sh 60 480 /tmp/peak_morning.log
#
# After the busy window, send /tmp/peak_*.log back for analysis.
set -u

INTERVAL="${1:-60}"
COUNT="${2:-60}"
OUT="${3:-/tmp/peak_$(date +%Y%m%d_%H%M).log}"

DB=$(docker ps --format '{{.Names}}' | grep -E -- '-db$' | head -1)
if [ -z "$DB" ]; then echo "ERROR: db container not found"; exit 1; fi

echo "Sampling every ${INTERVAL}s x ${COUNT} -> ${OUT}  (db=${DB})"

for i in $(seq 1 "$COUNT"); do
  {
    echo "### $(date '+%F %T')  iter ${i}/${COUNT}"
    # host load (1/5/15 min) and memory in MB
    uptime
    free -m | awk 'NR==2{printf "mem MB used=%s avail=%s (total=%s)\n", $3, $7, $2}'
    # per-container cpu + memory
    docker stats --no-stream --format \
      '{{.Name}}  cpu={{.CPUPerc}}  mem={{.MemUsage}} ({{.MemPerc}})' \
      "$(docker ps --format '{{.Names}}' | grep -E 'sms-platform' | tr '\n' ' ')" 2>/dev/null
    # DB: active query count, longest running query seconds, blocked backends
    docker exec -i "$DB" psql -U sms_user -d sms_platform -P pager=off -tA -c \
      "SELECT 'db active_queries='||count(*)
              ||' longest_s='||COALESCE(round(max(extract(epoch FROM now()-query_start)))::text,'0')
              ||' blocked='||(SELECT count(*) FROM pg_locks WHERE NOT granted)
       FROM pg_stat_activity
       WHERE datname='sms_platform' AND state='active' AND pid<>pg_backend_pid();"
    echo
  } >> "$OUT" 2>&1
  sleep "$INTERVAL"
done

echo "Done. Log: $OUT"
echo "Quick summary (peak CPU lines):"
grep -hE 'cpu=|load average' "$OUT" | sort | tail -20
