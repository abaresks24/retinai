/**
 * In-memory per-HUMAN free-trial counter.
 *
 * CRITICAL CORRECTNESS POINT: the key is `${nullifierHash}:${agentId}` — i.e. keyed by
 * the HUMAN (World ID nullifier), NOT by wallet. This is the whole point of HumanRank:
 * switching wallets does NOT reset the free trial, because the human behind the wallets
 * is the same nullifier. A wallet-keyed counter would be trivially sybil-farmable.
 */
export class TrialStore {
  private used = new Map<string, number>();

  private key(nullifierHash: string, agentId: number): string {
    return `${nullifierHash.toLowerCase()}:${agentId}`;
  }

  /** How many free calls this human has already spent against this agent. */
  usedCount(nullifierHash: string, agentId: number): number {
    return this.used.get(this.key(nullifierHash, agentId)) ?? 0;
  }

  /** Increment and return the new used count. */
  increment(nullifierHash: string, agentId: number): number {
    const k = this.key(nullifierHash, agentId);
    const next = (this.used.get(k) ?? 0) + 1;
    this.used.set(k, next);
    return next;
  }
}
