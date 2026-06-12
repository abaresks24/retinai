#!/usr/bin/env bash
# Extracts the .abi of the deployed contracts from contracts/out into shared/abi/<Name>.json
# so the backend/frontend can consume clean ABI arrays. Run after `forge build`.
set -euo pipefail

# Resolve directories relative to this script (contracts/).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT_DIR="$SCRIPT_DIR/out"
ABI_DIR="$SCRIPT_DIR/../shared/abi"

if ! command -v jq >/dev/null 2>&1; then
  echo "error: jq is required but not installed" >&2
  exit 1
fi

mkdir -p "$ABI_DIR"

CONTRACTS=("ReviewGate" "MockReputationRegistry" "MockIdentityRegistry")

for name in "${CONTRACTS[@]}"; do
  src="$OUT_DIR/$name.sol/$name.json"
  dst="$ABI_DIR/$name.json"
  if [[ ! -f "$src" ]]; then
    echo "error: $src not found — run 'forge build' first" >&2
    exit 1
  fi
  jq '.abi' "$src" > "$dst"
  echo "wrote $dst"
done

echo "exported ${#CONTRACTS[@]} ABIs to $ABI_DIR"
