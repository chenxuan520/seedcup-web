#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
port="${SEEDCUP_TEST_PORT:-4173}"
url="http://127.0.0.1:$port/"
server_log="${TMPDIR:-/tmp}/seedcup-web-preview-$$.log"
server_pid=""

cleanup() {
  if [[ -n "$server_pid" ]]; then
    kill "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
  fi
  rm -f "$server_log"
}
trap cleanup EXIT

cd "$repo_root"
npm run build
npm run preview -- --host 127.0.0.1 --port "$port" >"$server_log" 2>&1 &
server_pid=$!

for _ in $(seq 1 50); do
  if curl --fail --silent --output /dev/null "$url"; then
    break
  fi
  if ! kill -0 "$server_pid" 2>/dev/null; then
    cat "$server_log" >&2
    exit 1
  fi
  sleep 0.1
done

if ! curl --fail --silent --output /dev/null "$url"; then
  cat "$server_log" >&2
  echo "预览服务未能在 $url 启动。" >&2
  exit 1
fi

URL="$url" npx tsx scripts/advanced-check.ts
URL="$url" npx tsx scripts/autoplay-check.ts
URL="$url" npx tsx scripts/e2e.ts
