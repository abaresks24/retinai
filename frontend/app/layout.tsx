import type { Metadata } from "next";
import { Space_Grotesk } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

// Display typeface for the brand wordmark + headings.
const display = Space_Grotesk({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-display",
  display: "swap",
});

export const metadata: Metadata = {
  title: "RetinAI — sybil-resistant reputation for AI agents",
  description:
    "One human, one vote per agent. ERC-8004 reputation gated by World ID, agents named & verified by ENS (ENSIP-25).",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={display.variable}>
      {/* suppressHydrationWarning: browser extensions (Bitdefender/"bis_register",
          Grammarly, etc.) mutate <body> attributes before React hydrates. This silences
          that benign mismatch only; real mismatches in our own components still surface. */}
      <body suppressHydrationWarning>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
