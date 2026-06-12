import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "HumanRank — sybil-resistant reputation for AI agents",
  description:
    "One human, one vote per agent. ERC-8004 reputation gated by World ID, agents named & verified by ENS (ENSIP-25).",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
