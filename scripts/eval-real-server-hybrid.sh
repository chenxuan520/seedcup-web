#!/usr/bin/env bash
set -euo pipefail

server_root="$(realpath "${SEEDCUP_SERVER_ROOT:-../seedcup2023}")"
sdk_root="$(realpath "${SEEDCUP_CPP_SDK_ROOT:-../seedcup-cppsdk}")"
server_bin="$server_root/src/bin/server"
hard_bin="$sdk_root/src/bin/hard"
hybrid_bin="$sdk_root/src/bin/dl_bot"
model="$sdk_root/src/dl_bot_model_hard_rnnh512_actionctx_exactcf_head128_anchor075_mix050.rnn"
port="${SEEDCUP_EVAL_PORT:-19999}"
seeds="${SEEDCUP_EVAL_SEEDS:-20260801 20260802 20260803 20260804 20260805}"

for path in "$server_bin" "$hard_bin" "$hybrid_bin" "$model"; do
  if [[ ! -e "$path" ]]; then
    echo "missing required path: $path" >&2
    exit 2
  fi
done

work="$(mktemp -d)"
server_pid=""
client_pids=()
cleanup() {
  for pid in "${client_pids[@]}"; do
    kill "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
  done
  if [[ -n "$server_pid" ]]; then
    kill "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
  fi
  rm -rf "$work"
}
trap cleanup EXIT

mkdir -p "$work/bin"
ln -s "$hard_bin" "$work/bin/hard"
cp "$server_root/src/config.json" "$work/config.json"
cp "$sdk_root/src/config.json" "$work/client-config.json"

node - "$work/config.json" "$work/client-config.json" "$port" <<'NODE'
const fs = require('fs');
const [serverPath, clientPath, portText] = process.argv.slice(2);
const port = Number(portText);
const server = JSON.parse(fs.readFileSync(serverPath, 'utf8'));
Object.assign(server, {
  game_max_round: 300,
  game_print_map: false,
  game_snapshot: false,
  timer_initial_value: 80,
  round_interval_value: 80,
  result_path: `${serverPath}.result`,
  host: '127.0.0.1',
  port,
});
fs.writeFileSync(serverPath, JSON.stringify(server, null, 2));
const client = JSON.parse(fs.readFileSync(clientPath, 'utf8'));
client.host = '127.0.0.1';
client.port = port;
fs.writeFileSync(clientPath, JSON.stringify(client, null, 2));
NODE

wins=0
losses=0
draws=0
errors=0

for seed in $seeds; do
  for order in hybrid-first hard-first; do
    node - "$work/config.json" "$seed" <<'NODE'
const fs = require('fs');
const [path, seedText] = process.argv.slice(2);
const config = JSON.parse(fs.readFileSync(path, 'utf8'));
config.seed_random = Number(seedText);
fs.writeFileSync(path, JSON.stringify(config, null, 2));
NODE
    result_path="$work/config.json.result"
    rm -f "$result_path"
    (
      cd "$work/bin"
      "$server_bin" > "$work/server-$seed-$order.log" 2>&1
    ) &
    server_pid=$!

    ready=0
    for _ in {1..100}; do
      if ss -ltn | grep -q ":$port "; then
        ready=1
        break
      fi
      sleep 0.02
    done
    if [[ "$ready" -ne 1 ]]; then
      echo "seed=$seed order=$order result=server-start-error"
      errors=$((errors + 1))
      kill "$server_pid" 2>/dev/null || true
      wait "$server_pid" 2>/dev/null || true
      server_pid=""
      continue
    fi

    hybrid=(
      timeout 35 "$hybrid_bin"
      --config "$work/client-config.json"
      --model "$model"
      --hybrid-search
      --name hybrid
    )
    hard=(timeout 35 "$work/bin/hard")
    if [[ "$order" == "hybrid-first" ]]; then
      "${hybrid[@]}" > "$work/hybrid-$seed-$order.log" 2>&1 &
      first=$!
      client_pids+=("$first")
      sleep 0.05
      (cd "$work/bin" && "${hard[@]}") > "$work/hard-$seed-$order.log" 2>&1 &
      second=$!
      client_pids+=("$second")
    else
      (cd "$work/bin" && "${hard[@]}") > "$work/hard-$seed-$order.log" 2>&1 &
      first=$!
      client_pids+=("$first")
      sleep 0.05
      "${hybrid[@]}" > "$work/hybrid-$seed-$order.log" 2>&1 &
      second=$!
      client_pids+=("$second")
    fi
    wait "$first" 2>/dev/null || true
    wait "$second" 2>/dev/null || true
    client_pids=()
    kill "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
    server_pid=""

    if [[ ! -s "$result_path" ]]; then
      result=error
      errors=$((errors + 1))
    else
      result="$(node - "$result_path" <<'NODE'
const result = require(process.argv[2]);
const winners = result.winners.map((entry) => entry.player_name);
console.log(
  winners.includes('hybrid')
    ? 'win'
    : winners.includes('hard_bot')
      ? 'loss'
      : 'draw',
);
NODE
)"
      case "$result" in
        win) wins=$((wins + 1)) ;;
        loss) losses=$((losses + 1)) ;;
        draw) draws=$((draws + 1)) ;;
      esac
    fi
    echo "seed=$seed order=$order result=$result totals=$wins:$losses:$draws:error$errors"
  done
done

echo "real_server_hybrid wins=$wins losses=$losses draws=$draws errors=$errors"
