/** Generic HTTPS bank-data adapter for other aggregators (TrueLayer, Tink, Yapily, self-hosted). */
import { getConfig, setConfig } from "./secureConfig";
import { accounts, addAccount, addMoneyTransaction } from "../db/moneyTracker";

const KEYS = { endpoint: "customBank.endpoint", token: "customBank.token" } as const;
export type CustomConfig = { endpoint: string; token: string };

export async function loadCustomConfig(): Promise<CustomConfig> {
  const [endpoint, token] = await Promise.all([getConfig(KEYS.endpoint), getConfig(KEYS.token)]);
  return { endpoint: endpoint ?? "", token: token ?? "" };
}

export async function saveCustomConfig(config: CustomConfig) {
  await setConfig(KEYS.endpoint, config.endpoint);
  await setConfig(KEYS.token, config.token);
}

type Row = { name?: string; date?: string; merchant?: string; amountCents?: number; category?: string; kind?: string; account?: string };
type Response = { accounts?: Row[]; transactions?: Row[] };

/** Backend contract: POST {endpoint} → { accounts: [{name}], transactions: [{date, merchant, amountCents, category, kind, account}] }. */
export async function connectCustom() {
  const config = await loadCustomConfig();
  if (!config.endpoint) throw new Error("Configure an HTTPS endpoint first.");
  const response = await fetch(config.endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}) },
    body: JSON.stringify({ source: "pantry" }),
  });
  if (!response.ok) throw new Error(`Bank data endpoint failed (${response.status}).`);
  const data = await response.json() as Response;
  const names = [...(data.accounts ?? []).map((a) => a.name).filter(Boolean) as string[],
    ...new Set((data.transactions ?? []).map((t) => t.account).filter(Boolean) as string[])];
  for (const name of names.slice(0, 20)) {
    if ((await accounts()).some((a) => a.name === name)) continue;
    await addAccount(name, "bank");
  }
  const firstAccount = (await accounts())[0]?.id ?? "";
  for (const tx of data.transactions ?? []) {
    const cents = Math.abs(Number(tx.amountCents ?? 0));
    if (!cents) continue;
    const match = (await accounts()).find((a) => a.name === tx.account)?.id ?? firstAccount;
    await addMoneyTransaction({
      date: tx.date ?? new Date().toISOString().slice(0, 10),
      merchant: tx.merchant ?? "Bank transaction",
      amountCents: cents,
      category: tx.category ?? "Uncategorised",
      kind: tx.kind === "income" ? "income" : "expense",
      accountId: match,
    });
  }
  return { imported: (data.transactions ?? []).length, accounts: names.length };
}
