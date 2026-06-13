import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "Lynx — sybil-resistant reputation for AI agents",
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
      {/* suppressHydrationWarning: browser extensions (Bitdefender/"bis_register",
          Grammarly, etc.) mutate <body> attributes before React hydrates. This silences
          that benign mismatch only; real mismatches in our own components still surface. */}
      <body suppressHydrationWarning>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
