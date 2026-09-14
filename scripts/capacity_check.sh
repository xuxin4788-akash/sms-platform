#!/usr/bin/env bash
# Capacity / peak-load check (read-only). Safe to run; changes nothing.
# Usage on server:  sudo bash capacity_check.sh
set -u
DB_CONTAINER="adfd7a0cd183_sms-platform-db"
APP_CONTAINER="sms-platform-app"
PSQL=(docker exec -i "$DB_CONTAINER" psql -U sms_user -d sms_platform -P pager=off -tA)

line(){ printf '\n==================== %s ====================\n' "$1"; }

line "1. HOST CPU / MEM / LOAD"
nproc
free -h
uptime
echo "-- cpu cores / model --"
grep -m1 'model name' /proc/cpuinfo | cut -d: -f2

line "2. DISK (size + use)"
df -h / | sed 's/  */ /g'

line "3. CONTAINER LIVE USAGE (snapshot)"
docker stats --no-stream --format \
 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}\t{{.NetIO}}\t{{.BlockIO}}'

line "4. ARE compose deploy.limits ENFORCED? (empty = NOT enforced, using full host)"
for c in "$DB_CONTAINER" "$APP_CONTAINER" sms-platform-nginx; do
  echo "-- $c --"
  docker inspect "$c" --format 'NanoCpus={{.HostConfig.NanoCpus}} Memory={{.HostConfig.Memory}}'
done

line "5. POSTGRES SETTINGS vs CONTAINER"
"${PSQL[@]}" -c "
SELECT name||' = '||setting||'  ('||COALESCE(unit,'')||')' AS cfg
FROM pg_settings
WHERE name IN ('max_connections','shared_buffers','effective_cache_size',
               'work_mem','maintenance_work_mem','max_worker_processes',
               'max_parallel_workers','shared_buffers');"
echo "-- postgres RSS actually used (MB) --"
docker stats --no-stream --format '{{.MemUsage}}' "$DB_CONTAINER"

line "6. DB CONNECTIONS (active / idle / max)"
"${PSQL[@]}" -c "
SELECT state, count(*) FROM pg_stat_activity
WHERE datname='sms_platform' GROUP BY state ORDER BY state;"
"${PSQL[@]}" -c "SELECT 'max_connections='||current_setting('max_connections');"

line "7. LOCKS / BLOCKING RIGHT NOW"
"${PSQL[@]}" -c "
SELECT count(*) AS lock_waiting FROM pg_locks WHERE NOT granted;"
"${PSQL[@]}" -c "
SELECT blocked.pid AS blocked_pid, blocking.pid AS blocking_pid,
       left(blocked.query,60) AS blocked_query
FROM pg_stat_activity blocked
JOIN pg_stat_activity blocking ON blocking.pid = ANY(pg_blocking_pids(blocked.pid))
LIMIT 10;"

line "8. TABLE SIZES (real footprint)"
"${PSQL[@]}" -c "
SELECT relname,
       pg_size_pretty(pg_total_relation_size(relid)) AS total,
       n_live_tup AS approx_rows
FROM pg_stat_user_tables
ORDER BY pg_total_relation_size(relid) DESC LIMIT 12;"

line "9. SMS VOLUME / DAY (UTC+8 carrier day, last 14 days)"
"${PSQL[@]}" -c "
SELECT to_char((sent_at AT TIME ZONE 'UTC' + INTERVAL '8 hours')::date,'YYYY-MM-DD') d,
       count(*) rows,
       count(*) FILTER (WHERE status='sent') st_sent,
       count(*) FILTER (WHERE status='delivered') delivered,
       count(*) FILTER (WHERE status='failed') failed,
       sum(billed_segments) segments
FROM sms_records
WHERE sent_at >= now() - INTERVAL '15 days'
GROUP BY 1 ORDER BY 1;"

line "10. PEAK SMS / HOUR (busiest 12 hours, last 7 days)"
"${PSQL[@]}" -c "
SELECT date_trunc('hour', sent_at AT TIME ZONE 'UTC' + INTERVAL '8 hours') h,
       count(*) rows
FROM sms_records
WHERE sent_at >= now() - INTERVAL '7 days'
GROUP BY 1 ORDER BY count(*) DESC LIMIT 12;"

line "11. ACTIVE USERS / DAY (last 7 days)"
"${PSQL[@]}" -c "
SELECT to_char((sent_at AT TIME ZONE 'UTC' + INTERVAL '8 hours')::date,'YYYY-MM-DD') d,
       count(DISTINCT created_by) senders
FROM sms_records
WHERE sent_at >= now() - INTERVAL '7 days'
GROUP BY 1 ORDER BY 1;"

line "12. SLOW / LONG-RUNNING QUERIES RIGHT NOW (>5s)"
"${PSQL[@]}" -c "
SELECT pid, state, now()-query_start dur, wait_event_type w, left(query,80) q
FROM pg_stat_activity
WHERE datname='sms_platform' AND state='active'
  AND now()-query_start > INTERVAL '5 seconds'
ORDER BY query_start;"

line "13. GUNICORN WORKERS (app concurrency)"
docker exec -i "$APP_CONTAINER" sh -lc 'ps aux | grep -c "[g]unicorn: worker" || true' 2>/dev/null || echo "ps not available"

line "14. CACHE EFFECTIVENESS (hit ratio should be >95%)"
"${PSQL[@]}" -c "
SELECT round(100.0*sum(heap_blks_hit)/NULLIF(sum(heap_blks_hit)+sum(heap_blks_read),0),1)
       AS cache_hit_pct
FROM pg_statio_user_tables;"

line "DONE"
