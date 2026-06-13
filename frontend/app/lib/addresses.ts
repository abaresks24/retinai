/**
 * Loads the deployed addresses (materialized into /public by the copy-shared prebuild
 * step). Prefers /addresses.deployed.json (the committed live Arc-testnet snapshot, so
 * the deployed site has agents with NO backend) and falls back to /addresses.local.json
 * for local anvil dev. Handles the file being absent / all-zero (contracts not deployed)
 * gracefully — never throws, returns a `loaded`/`deployed` flag the UI keys off.
 */
export type AgentRecord = {
  agentId: number;
  ensName: string;
  wallet: string;
  agentURI: string;
  endpoint: string;
  registryForEnsip25?: string;
};

export type Addresses = {
  chainId: number;
  rpcUrl: string;
  ReviewGate: string;
  ReputationRegistry: string;
  IdentityRegistry: string;
  attestor: string;
  agents: AgentRecord[];
};

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export function isZero(addr?: string): boolean {
  return !addr || addr.toLowerCase() === ZERO_ADDRESS;
}

export type AddressesState = {
  addresses: Addresses | null;
  loaded: boolean; // file was found + parsed
  deployed: boolean; // IdentityRegistry is a real (non-zero) address
};

const EMPTY: Addresses = {
  chainId: 31337,
  rpcUrl: "http://127.0.0.1:8545",
  ReviewGate: ZERO_ADDRESS,
  ReputationRegistry: ZERO_ADDRESS,
  IdentityRegistry: ZERO_ADDRESS,
  attestor: ZERO_ADDRESS,
  agents: [],
};

async function fetchAddressesFile(path: string): Promise<Addresses | null> {
  try {
    const res = await fetch(path, { cache: "no-store" });
    if (!res.ok) return null;
    const parsed = (await res.json()) as Partial<Addresses>;
    return {
      ...EMPTY,
      ...parsed,
      agents: Array.isArray(parsed.agents) ? parsed.agents : [],
    };
  } catch {
    return null;
  }
}

let _cache: AddressesState | null = null;

export async function loadAddresses(): Promise<AddressesState> {
  if (_cache) return _cache;
  // Prefer the committed deployed snapshot (live Arc testnet), fall back to local anvil.
  const addresses =
    (await fetchAddressesFile("/addresses.deployed.json")) ??
    (await fetchAddressesFile("/addresses.local.json"));
  if (!addresses) {
    return { addresses: EMPTY, loaded: false, deployed: false };
  }
  const deployed = !isZero(addresses.IdentityRegistry);
  _cache = { addresses, loaded: true, deployed };
  return _cache;
}
