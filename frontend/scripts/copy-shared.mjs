/**
 * prebuild/predev: copy shared/addresses.local.json + shared/abi/*.json into public/
 * so the client can fetch them. Next can't easily import files outside the app dir, so
 * we materialize them as static assets. Everything is best-effort: if shared files are
 * absent (contracts not deployed yet) we write nothing and the UI degrades gracefully.
 */
import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
// frontend/scripts -> repo root is ../../
const REPO_ROOT = resolve(__dirname, "..", "..");
const SHARED = resolve(REPO_ROOT, "shared");
const PUBLIC = resolve(__dirname, "..", "public");
const PUBLIC_ABI = resolve(PUBLIC, "abi");

mkdirSync(PUBLIC, { recursive: true });
mkdirSync(PUBLIC_ABI, { recursive: true });

function tryCopy(src, dst, label) {
  if (existsSync(src)) {
    cpSync(src, dst);
    console.log(`[copy-shared] ${label}: ${src} -> ${dst}`);
    return true;
  }
  console.warn(`[copy-shared] ${label}: ${src} not found (skipping)`);
  return false;
}

// addresses: prefer the real local file, fall back to the example so the UI has shape.
const addrLocal = resolve(SHARED, "addresses.local.json");
const addrExample = resolve(SHARED, "addresses.local.example.json");
if (!tryCopy(addrLocal, resolve(PUBLIC, "addresses.local.json"), "addresses")) {
  tryCopy(addrExample, resolve(PUBLIC, "addresses.local.json"), "addresses(example fallback)");
}

// DEPLOYED addresses: the committed snapshot of the live (Arc testnet) deployment. This is
// the file the deployed frontend reads to list real agents + read live on-chain scores
// with NO backend. Prefer addresses.deployed.json; for local dev fall back to the local
// anvil file so `npm run dev` works against a fresh local deploy too.
const addrDeployed = resolve(SHARED, "addresses.deployed.json");
const deployedDst = resolve(PUBLIC, "addresses.deployed.json");
if (!tryCopy(addrDeployed, deployedDst, "addresses.deployed")) {
  if (!tryCopy(addrLocal, deployedDst, "addresses.deployed(local fallback)")) {
    tryCopy(addrExample, deployedDst, "addresses.deployed(example fallback)");
  }
}

// policy spec: the frozen templates + categories the delegation flow renders.
tryCopy(
  resolve(SHARED, "policy-templates.json"),
  resolve(PUBLIC, "policy-templates.json"),
  "policy-templates",
);
// optional deployed cage addresses (AgentVault factory etc.) — best-effort.
tryCopy(
  resolve(SHARED, "policy-addresses.json"),
  resolve(PUBLIC, "policy-addresses.json"),
  "policy-addresses",
);

// ABIs: copy any *.json present in shared/abi.
const abiDir = resolve(SHARED, "abi");
if (existsSync(abiDir)) {
  for (const f of readdirSync(abiDir)) {
    if (f.endsWith(".json")) {
      tryCopy(resolve(abiDir, f), resolve(PUBLIC_ABI, f), `abi/${f}`);
    }
  }
} else {
  console.warn(`[copy-shared] ${abiDir} not found (frontend will use inline ABI fallbacks)`);
}
