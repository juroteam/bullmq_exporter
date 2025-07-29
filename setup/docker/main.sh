#!/usr/bin/env bash
set -euo pipefail

prefix="${EXPORTER_PREFIX:-bull}"
metric_prefix="${EXPORTER_STAT_PREFIX:-bull_queue_}"
queues="${EXPORTER_QUEUES:-}"
EXPORTER_AUTODISCOVER="${EXPORTER_AUTODISCOVER:-}"

# Sentinel configuration - required
sentinel_hosts="${EXPORTER_SENTINEL_HOSTS:-}"
sentinel_name="${EXPORTER_SENTINEL_NAME:-}"
sentinel_password="${EXPORTER_SENTINEL_PASSWORD:-}"

# Validate required Sentinel configuration
if [[ -z "$sentinel_hosts" ]] ; then
  echo "Error: EXPORTER_SENTINEL_HOSTS environment variable is required"
  exit 1
fi

if [[ -z "$sentinel_name" ]] ; then
  echo "Error: EXPORTER_SENTINEL_NAME environment variable is required"
  exit 1
fi

flags=(
  --prefix "$prefix"
  --metric-prefix "$metric_prefix"
  --sentinel-hosts "$sentinel_hosts"
  --sentinel-name "$sentinel_name"
)

# Add password if provided
if [[ -n "$sentinel_password" ]] ; then
  flags+=(--sentinel-password "$sentinel_password")
fi

if [[ "$EXPORTER_AUTODISCOVER" != 0 && "$EXPORTER_AUTODISCOVER" != 'false' ]] ; then
  flags+=(-a)
fi

# shellcheck disable=2206
flags+=($queues)

exec node dist/src/index.js "${flags[@]}"
