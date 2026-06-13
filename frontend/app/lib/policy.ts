/**
 * Loads shared/policy-templates.json (materialized into /public by the copy-shared
 * prebuild step). The FROZEN spec: protocol-curated categories + one-tap templates that
 * compose categories + caps. Everything degrades gracefully — if the file is absent we
 * fall back to an inline copy so the delegation flow works fully offline for the demo.
 */
export type PolicyPeriod = "daily" | "weekly" | "monthly";

export type PolicyCategory = {
  key: string;
  label: string;
  description: string;
  curated: boolean;
};

export type PolicyTemplate = {
  id: string;
  name: string;
  summary: string;
  categories: string[];
  perTxCap: number;
  budget: number;
  period: PolicyPeriod;
};

export type PolicySpec = {
  categories: PolicyCategory[];
  templates: PolicyTemplate[];
};

/** Inline fallback (mirrors shared/policy-templates.json) so the UI never blanks out. */
const FALLBACK: PolicySpec = {
  categories: [
    { key: "STABLECOINS", label: "Stablecoins", description: "USDC, USDT, DAI", curated: true },
    { key: "DEX_BLUECHIP", label: "Blue-chip DEXes", description: "Audited swap routers (Uniswap, 1inch, CoW…)", curated: true },
    { key: "LENDING", label: "Lending markets", description: "Audited lending (Aave, Morpho, Compound)", curated: true },
    { key: "STAKING", label: "Liquid staking", description: "Lido, Rocket Pool, …", curated: true },
    { key: "AGENT_SERVICES", label: "Agent services", description: "x402 API / inference / data providers", curated: true },
    { key: "SAVED_PAYEES", label: "Saved payees", description: "Recipients you've added yourself", curated: false },
    { key: "MY_ACCOUNTS", label: "My own accounts", description: "Your other wallets", curated: false },
  ],
  templates: [
    { id: "dca", name: "Dollar-cost averaging", summary: "Buys a fixed amount on blue-chip DEXes, capped per day.", categories: ["DEX_BLUECHIP", "STABLECOINS"], perTxCap: 100, budget: 1000, period: "daily" },
    { id: "yield", name: "Yield optimizer", summary: "Moves stablecoins between audited lending markets to chase the best rate, 24/7.", categories: ["LENDING", "STABLECOINS"], perTxCap: 2000, budget: 20000, period: "daily" },
    { id: "payments", name: "Recurring payments", summary: "Pays your saved recipients on schedule — payroll, subscriptions, invoices.", categories: ["SAVED_PAYEES", "STABLECOINS"], perTxCap: 500, budget: 5000, period: "weekly" },
    { id: "trading", name: "Trading strategy", summary: "Executes a strategy on blue-chip DEXes within a strict daily budget.", categories: ["DEX_BLUECHIP"], perTxCap: 1000, budget: 5000, period: "daily" },
    { id: "micro", name: "Agent services (x402)", summary: "Pays for APIs, inference and data per call — thousands of micro-payments no human could approve.", categories: ["AGENT_SERVICES"], perTxCap: 1, budget: 50, period: "daily" },
  ],
};

/** Curated allowlist sizes per category — illustrative counts for the demo UI. */
const CURATED_COUNTS: Record<string, number> = {
  STABLECOINS: 3,
  DEX_BLUECHIP: 6,
  LENDING: 4,
  STAKING: 3,
  AGENT_SERVICES: 12,
  SAVED_PAYEES: 0,
  MY_ACCOUNTS: 0,
};

export async function loadPolicySpec(): Promise<PolicySpec> {
  try {
    const res = await fetch("/policy-templates.json", { cache: "no-store" });
    if (!res.ok) return FALLBACK;
    const parsed = (await res.json()) as Partial<PolicySpec>;
    if (!Array.isArray(parsed.templates) || !Array.isArray(parsed.categories)) return FALLBACK;
    return { categories: parsed.categories, templates: parsed.templates };
  } catch {
    return FALLBACK;
  }
}

export function categoryByKey(spec: PolicySpec, key: string): PolicyCategory | undefined {
  return spec.categories.find((c) => c.key === key);
}

/** Number of curated (vetted) addresses unlocked by a template's curated categories. */
export function curatedAddressCount(template: PolicyTemplate): number {
  return template.categories.reduce((sum, k) => sum + (CURATED_COUNTS[k] ?? 0), 0);
}

export function periodWord(period: PolicyPeriod): string {
  return period === "daily" ? "per day" : period === "weekly" ? "per week" : "per month";
}

export function fmtUsd(n: number): string {
  if (!Number.isFinite(n)) return "$0";
  return "$" + n.toLocaleString("en-US", { maximumFractionDigits: n < 1 ? 2 : 0 });
}

/**
 * Plain-language sentence describing exactly what the agent CAN do, given a template and
 * the (possibly edited) caps. A non-crypto user reads this and understands the cage.
 */
export function plainPolicySentence(
  spec: PolicySpec,
  template: PolicyTemplate,
  perTxCap: number,
  budget: number,
): { can: string; cats: PolicyCategory[] } {
  const cats = template.categories
    .map((k) => categoryByKey(spec, k))
    .filter((c): c is PolicyCategory => Boolean(c));
  const list = cats.map((c) => c.label.toLowerCase());
  const catPhrase =
    list.length <= 1
      ? list[0] ?? "vetted addresses"
      : list.slice(0, -1).join(", ") + " and " + list[list.length - 1];
  const can = `This agent can move up to ${fmtUsd(perTxCap)} per transaction, ${fmtUsd(
    budget,
  )} ${periodWord(template.period)}, only on ${catPhrase}.`;
  return { can, cats };
}
