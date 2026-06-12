"use client";

/**
 * wagmi + react-query providers. We configure a minimal wagmi client (no wallet
 * connectors needed for the demo — reads go through our own viem public client, writes
 * go through the backend attestor) so the app stays dependency-light and never blocks
 * on a wallet being present.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { WagmiProvider, createConfig, http } from "wagmi";
import { defineChain } from "viem";
import { RPC_URL } from "./lib/viem";

const anvil = defineChain({
  id: 31337,
  name: "Anvil",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
});

const wagmiConfig = createConfig({
  chains: [anvil],
  transports: { [anvil.id]: http(RPC_URL) },
  ssr: true,
});

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
