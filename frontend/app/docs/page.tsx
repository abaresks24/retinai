import Link from "next/link";

export const metadata = {
  title: "HumanRank — Docs",
  description: "How HumanRank makes ERC-8004 agent reputation sybil-proof with World ID + ENS.",
};

export default function DocsPage() {
  return (
    <div className="docs">
      <Link href="/" className="back">← Home</Link>
      <h1>HumanRank — Docs</h1>
      <p>
        <b>The sybil-proof human review layer for ERC-8004.</b> Everyone built the rails to{" "}
        <i>pay</i> AI agents. Nobody built the way to know <b>which ones deserve it</b>.
      </p>

      <h2>The problem</h2>
      <p>
        ERC-8004 is the on-chain standard for AI-agent identity and reputation. Its reputation
        registry is <b>permissionless</b> and has <b>no global average</b> — anyone can spin up
        N wallets and self-review an agent to a perfect 5.0★. We verified this live on Base: the
        deployed registry&apos;s only sybil defense is blocking the agent&apos;s own owner, so any
        fresh wallet can farm it. Roughly half of agent-payment volume today is wash/self-dealing.
      </p>

      <h2>How HumanRank fixes it</h2>
      <p>
        HumanRank gates every reputation <i>write</i> by a <b>World ID nullifier</b> — an
        anonymous token that is unique per human. One human can review a given agent exactly
        once, enforced on-chain. 100 wallets controlled by one person collapse to one vote.
      </p>

      <div className="steps">
        <div className="step"><span className="n">1</span><div><b>Discover</b> — agents are listed by ENS name, with a live <b>ENSIP-25</b> badge that cross-checks the ENS↔ERC-8004 binding on-chain (green = verified, red = spoofed).</div></div>
        <div className="step"><span className="n">2</span><div><b>Try</b> — 3 free calls <b>per human</b> (not per wallet) via World ID; the 4th triggers an <b>x402</b> USDC micropayment.</div></div>
        <div className="step"><span className="n">3</span><div><b>Review</b> — leave a rating; the attestor writes it into the ERC-8004 ReputationRegistry, gated so one human votes once.</div></div>
        <div className="step"><span className="n">4</span><div><b>Compare</b> — see the raw farmable score (5.0★) vs the HumanRank human-weighted score side by side.</div></div>
      </div>

      <h2>The standards we use</h2>
      <ul>
        <li><b>ERC-8004</b> — AI-agent identity + reputation registries (we write to the canonical registry on Base).</li>
        <li><b>World ID / AgentKit</b> — proof of unique human; the <code>nullifier</code> is the one-vote primitive.</li>
        <li><b>ENSIP-25 / 26</b> — ENS text records binding a name to its ERC-8004 agent and endpoints; we are the first to verify them client-side.</li>
        <li><b>x402</b> — HTTP 402 micropayments in USDC for agent calls.</li>
      </ul>

      <h2>Trust model</h2>
      <p>
        World ID proof <i>verification</i> is performed off-chain by a trusted attestor (there is
        no Base-side verifier contract). The <b>one-human-one-vote uniqueness invariant is
        enforced fully on-chain</b> in the ReviewGate contract — only the proof check is delegated.
      </p>

      <p style={{ marginTop: 32 }}>
        <Link href="/app" className="btn btn-primary">Launch app →</Link>
      </p>
    </div>
  );
}
