#!/usr/bin/env bash
# run-local.sh — bring up the full Lynx local stack, idempotently.
#
#   1. start anvil (if port 8545 is free)
#   2. forge deploy (if shared/addresses.local.json is missing) + export ABIs
#   3. seed a few legitimate human reviews
#   4. start backend (8787) and frontend (3000), wait for health
#   5. print URLs and leave everything running until Ctrl-C
#
# Background processes started BY THIS SCRIPT are tracked and killed on exit. An anvil that was
# already running before this script started is left alone.
set -uo pipefail

# --- paths --------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CONTRACTS="$ROOT/contracts"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"
SHARED="$ROOT/shared"
ADDR_FILE="$SHARED/addresses.local.json"

RPC_URL="http://127.0.0.1:8545"
BACKEND_URL="http://127.0.0.1:8787"
FRONTEND_URL="http://127.0.0.1:3000"

# Anvil acct0 — deployer + attestor.
DEPLOYER_PK="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"

# --- colors -------------------------------------------------------------------
B="\033[1m"; D="\033[2m"; G="\033[32m"; Y="\033[33m"; R="\033[31m"; N="\033[0m"
step() { echo -e "${B}==>${N} $*"; }
ok()   { echo -e "  ${G}✓${N} $*"; }
warn() { echo -e "  ${Y}!${N} $*"; }
die()  { echo -e "  ${R}✗${N} $*" >&2; exit 1; }

# --- process tracking / teardown ---------------------------------------------
STARTED_PIDS=()
ANVIL_STARTED=0
ANVIL_PID=""

cleanup() {
  echo ""
  step "Shutting down processes started by this script…"
  for pid in "${STARTED_PIDS[@]:-}"; do
    if [[ -n "${pid}" ]] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null && ok "killed pid $pid"
    fi
  done
  if [[ "$ANVIL_STARTED" == "1" && -n "$ANVIL_PID" ]] && kill -0 "$ANVIL_PID" 2>/dev/null; then
    kill "$ANVIL_PID" 2>/dev/null && ok "killed anvil (pid $ANVIL_PID)"
  fi
  echo -e "${D}  (an anvil that was already running before this script is left untouched)${N}"
}
trap cleanup EXIT INT TERM

port_in_use() { lsof -iTCP:"$1" -sTCP:LISTEN -n -P >/dev/null 2>&1; }

wait_for() { # url, name, tries
  local url="$1" name="$2" tries="${3:-60}"
  for ((i = 0; i < tries; i++)); do
    if curl -fsS "$url" >/dev/null 2>&1; then ok "$name is up ($url)"; return 0; fi
    sleep 1
  done
  die "$name did not become healthy at $url"
}

# --- 0. tool checks -----------------------------------------------------------
command -v curl >/dev/null || die "curl is required"

# --- 1. anvil -----------------------------------------------------------------
step "Anvil (chain 31337 @ $RPC_URL)"
if port_in_use 8545; then
  ok "anvil already running — reusing it"
else
  command -v anvil >/dev/null || die "anvil not found (install Foundry)"
  step "starting anvil…"
  anvil --silent >"$ROOT/anvil.log" 2>&1 &
  ANVIL_PID=$!
  ANVIL_STARTED=1
  for ((i = 0; i < 30; i++)); do port_in_use 8545 && break; sleep 0.5; done
  port_in_use 8545 || die "anvil failed to start (see $ROOT/anvil.log)"
  ok "anvil started (pid $ANVIL_PID, log: anvil.log)"
fi

# --- 2. deploy + export ABIs --------------------------------------------------
step "Contracts"
NEED_DEPLOY=0
if [[ ! -f "$ADDR_FILE" ]]; then
  NEED_DEPLOY=1
elif ! curl -fsS -X POST "$RPC_URL" -H 'content-type: application/json' \
      --data '{"jsonrpc":"2.0","id":1,"method":"eth_getCode","params":["'"$(grep -o '"ReviewGate"[^,]*' "$ADDR_FILE" | grep -o '0x[0-9a-fA-F]*')"'","latest"]}' \
      | grep -q '"result":"0x[0-9a-fA-F]'; then
  # addresses file exists but the contract has no code on this chain (fresh anvil) -> redeploy
  warn "addresses file present but ReviewGate has no code on-chain — redeploying"
  NEED_DEPLOY=1
fi

if [[ "$NEED_DEPLOY" == "1" ]]; then
  command -v forge >/dev/null || die "forge not found (install Foundry)"
  step "deploying contracts (forge script Deploy)…"
  ( cd "$CONTRACTS" && forge script script/Deploy.s.sol:Deploy \
      --rpc-url "$RPC_URL" --private-key "$DEPLOYER_PK" --broadcast -q ) \
    || die "forge deploy failed"
  ok "contracts deployed"
  step "exporting ABIs…"
  ( cd "$CONTRACTS" && bash export-abi.sh ) || die "export-abi.sh failed"
  ok "ABIs exported to shared/abi/"
else
  ok "contracts already deployed (addresses.local.json present + code on-chain)"
  # Make sure ABIs exist even on the reuse path.
  if [[ ! -f "$SHARED/abi/ReviewGate.json" ]]; then
    step "exporting ABIs…"
    ( cd "$CONTRACTS" && bash export-abi.sh ) || warn "export-abi.sh failed (continuing)"
  fi
fi

# --- 3. scripts deps + seed ---------------------------------------------------
step "Demo scripts"
if [[ ! -d "$SCRIPT_DIR/node_modules" ]]; then
  step "installing scripts deps (npm install)…"
  ( cd "$SCRIPT_DIR" && npm install --silent ) || die "npm install failed in scripts/"
fi
ok "scripts deps ready"
step "seeding legitimate human reviews…"
( cd "$SCRIPT_DIR" && npx tsx seed.ts ) || warn "seed.ts failed (continuing)"

# --- 4. backend ---------------------------------------------------------------
step "Backend (Hono @ $BACKEND_URL)"
if port_in_use 8787; then
  ok "backend already running — reusing it"
else
  if [[ -f "$BACKEND/package.json" ]]; then
    [[ -d "$BACKEND/node_modules" ]] || ( cd "$BACKEND" && npm install --silent )
    [[ -f "$BACKEND/.env" ]] || { [[ -f "$BACKEND/.env.example" ]] && cp "$BACKEND/.env.example" "$BACKEND/.env" && warn "created backend/.env from .env.example"; }
    ( cd "$BACKEND" && npm run dev >"$ROOT/backend.log" 2>&1 ) &
    STARTED_PIDS+=($!)
    ok "backend starting (pid $!, log: backend.log)"
    wait_for "$BACKEND_URL/health" "backend" 60
  else
    warn "no backend/package.json — skipping backend"
  fi
fi

# --- 5. frontend --------------------------------------------------------------
step "Frontend (Next.js @ $FRONTEND_URL)"
if port_in_use 3000; then
  ok "frontend already running — reusing it"
else
  if [[ -f "$FRONTEND/package.json" ]]; then
    [[ -d "$FRONTEND/node_modules" ]] || ( cd "$FRONTEND" && npm install --silent )
    ( cd "$FRONTEND" && npm run dev >"$ROOT/frontend.log" 2>&1 ) &
    STARTED_PIDS+=($!)
    ok "frontend starting (pid $!, log: frontend.log)"
    wait_for "$FRONTEND_URL" "frontend" 90
  else
    warn "no frontend/package.json — skipping frontend"
  fi
fi

# --- done ---------------------------------------------------------------------
echo ""
echo -e "${B}${G}Lynx local stack is up.${N}"
echo -e "  ${B}RPC      ${N} $RPC_URL"
echo -e "  ${B}Backend  ${N} $BACKEND_URL    ${D}(GET /health, /agents)${N}"
echo -e "  ${B}Frontend ${N} $FRONTEND_URL"
echo ""
echo -e "  Run the sybil attack demo:  ${B}cd scripts && npx tsx attack.ts${N}"
echo ""

# Keep foreground alive so the trap can tear down children. If we started nothing in the
# background (all reused), exit cleanly and leave the reused services running.
if [[ ${#STARTED_PIDS[@]} -eq 0 && "$ANVIL_STARTED" == "0" ]]; then
  warn "everything was already running — nothing new to babysit, exiting (services stay up)."
  trap - EXIT INT TERM
  exit 0
fi

echo -e "${D}  Press Ctrl-C to stop the processes this script started.${N}"
wait
