#!/usr/bin/env bash
# Fetch + cache GTFS feeds from Transitland, skip re-download if unchanged.
# Usage: ./gtfs-fetch.sh <onestop_id> [<onestop_id> ...]
#   e.g. ./gtfs-fetch.sh f-transjakarta f-jaklingko
set -euo pipefail

API="https://transit.land/api/v2/rest"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CACHE_DIR="${GTFS_CACHE_DIR:-$HERE/data}"
ENV_FILE="${GTFS_ENV_FILE:-$HERE/.env}"

# Load key from .env if not already in environment
if [[ -z "${TRANSITLAND_API_KEY:-}" && -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  set -a; source "$ENV_FILE"; set +a
fi
: "${TRANSITLAND_API_KEY:?set TRANSITLAND_API_KEY (env or $ENV_FILE)}"

[[ $# -ge 1 ]] || { echo "usage: $0 <onestop_id> [<onestop_id> ...]" >&2; exit 2; }

auth=(-H "apikey: $TRANSITLAND_API_KEY")
mkdir -p "$CACHE_DIR"

fetch_one() {
  local id="$1"
  local dir="$CACHE_DIR/$id"
  local sha_file="$dir/.sha1"
  mkdir -p "$dir"

  # Latest feed version sha1 (source of truth for "did data change?")
  local latest
  latest=$(curl -fsS "${auth[@]}" "$API/feeds/$id/feed_versions?limit=1" \
    | jq -r '.feed_versions[0].sha1 // empty')
  if [[ -z "$latest" ]]; then
    echo "!! $id: no feed version found (bad onestop_id or no data)" >&2
    return 1
  fi

  if [[ -f "$sha_file" && "$(cat "$sha_file")" == "$latest" ]]; then
    echo "== $id: up to date ($latest)"
    return 0
  fi

  echo ">> $id: downloading $latest"
  curl -fsSL "${auth[@]}" "$API/feeds/$id/download_latest_feed_version" -o "$dir/gtfs.zip"
  rm -rf "$dir/extracted" && mkdir -p "$dir/extracted"
  unzip -oq "$dir/gtfs.zip" -d "$dir/extracted"
  echo "$latest" > "$sha_file"
  echo "OK $id: cached -> $dir/extracted ($(du -sh "$dir/gtfs.zip" | cut -f1))"
}

rc=0
for id in "$@"; do fetch_one "$id" || rc=1; done
exit $rc
