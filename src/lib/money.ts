// Roblox money rules, shared by server pages and browser components.
// Source: create.roblox.com/docs/production/monetization/developer-exchange

/** US dollars paid per earned Robux through Developer Exchange (since 5 Sept 2025). */
export const DEVEX_RATE = 0.0038;
/** Earned Robux needed before a cash-out is allowed. */
export const DEVEX_MINIMUM = 30_000;
/** Share of a game pass or developer product sale that reaches the creator. */
export const CREATOR_SHARE = 0.7;

export const robuxToUsd = (robux: number, rate = DEVEX_RATE) => robux * rate;

export function fmtUsd(n: number): string {
  const abs = Math.abs(n);
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: abs < 100 ? 2 : 0, maximumFractionDigits: abs < 100 ? 2 : 0 })}`;
}

export const fmtRobux = (n: number) => `${Math.round(n).toLocaleString("en-US")} R$`;
