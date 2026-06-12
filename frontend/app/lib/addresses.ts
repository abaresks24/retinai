/**
 * Loads shared/addresses.local.json (materialized into /public by the copy-shared
 * prebuild step). Handles the file being absent / all-zero (contracts not deployed)
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

export async function loadAddresses(): Promise<AddressesState> {
  try {
    const res = await fetch("/addresses.local.json", { cache: "no-store" });
    if (!res.ok) return { addresses: EMPTY, loaded: false, deployed: false };
    const parsed = (await res.json()) as Partial<Addresses>;
    const addresses: Addresses = {
      ...EMPTY,
      ...parsed,
      agents: Array.isArray(parsed.agents) ? parsed.agents : [],
    };
    const deployed = !isZero(addresses.IdentityRegistry);
    return { addresses, loaded: true, deployed };
  } catch {
    return { addresses: EMPTY, loaded: false, deployed: false };
  }
}
