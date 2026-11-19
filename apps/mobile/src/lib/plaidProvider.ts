/**
 * Plaid Link (native SDK v13) adapter.
 *
 * Plaid requires a backend to create the link_token and to exchange the
 * short-lived public_token. The backend URL is configured at runtime; no keys
 * are bundled. The native Link SDK needs a development build (not Expo Go,
 * not web) — the UI reports that clearly on web.
 */
import { Platform } from "react-native";
import { getConfig, setConfig } from "./secureConfig";
import { accounts, addAccount, addMoneyTransaction } from "../db/moneyTracker";

const KEYS = { backend: "plaid.backendUrl", clientId: "plaid.clientId", environment: "plaid.environment", userId: "plaid.userId" } as const;

export type PlaidConfig = { backendUrl: string; clientId: string; environment: "sandbox" | "production"; userId: string };
type LinkSuccess = { publicToken: string; metadata: { accounts?: { name?: string; id: string }[]; institution?: { name?: string } } };

const plaidModule = Platform.OS === "web" ? null : require("react-native-plaid-link-sdk") as typeof import("react-native-plaid-link-sdk");

export async function loadPlaidConfig(): Promise<PlaidConfig> {
  const [backendUrl, clientId, environment, userId] = await Promise.all([
    getConfig(KEYS.backend), getConfig(KEYS.clientId), getConfig(KEYS.environment), getConfig(KEYS.userId),
  ]);
  return {
    backendUrl: backendUrl ?? "",
    clientId: clientId ?? "",
    environment: environment === "production" ? "production" : "sandbox",
    userId: userId ?? "pantry-local-user",
  };
}

export async function savePlaidConfig(config: PlaidConfig) {
  await Promise.all([
    setConfig(KEYS.backend, config.backendUrl),
    setConfig(KEYS.clientId, config.clientId),
    setConfig(KEYS.environment, config.environment),
    setConfig(KEYS.userId, config.userId),
  ]);
}

export const plaidAvailable = () => Platform.OS !== "web" && !!plaidModule;

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Plaid backend request failed (${response.status}) at ${new URL(url).pathname}.`);
  return response.json() as Promise<T>;
}

/** Backend contract: POST {backend}/create_link_token → { link_token }. */
async function createLinkToken(config: PlaidConfig): Promise<string> {
  const data = await postJson<{ link_token?: string }>(`${config.backendUrl.replace(/\/$/, "")}/create_link_token`, {
    clientId: config.clientId, environment: config.environment, userId: config.userId,
  });
  if (!data.link_token) throw new Error("Your backend did not return a link_token.");
  return data.link_token;
}

type ImportedTx = { date?: string; merchant?: string; amountCents?: number; category?: string; kind?: string };
type ExchangeResult = { accounts?: { name?: string }[]; transactions?: ImportedTx[] };

/** Opens Plaid Link and imports whatever the configured backend returns. */
export async function connectWithPlaid(): Promise<{ imported: number; message: string }> {
  if (!plaidAvailable()) throw new Error("Plaid Link needs a native development build (not Expo Go or web).");
  const config = await loadPlaidConfig();
  if (!config.backendUrl) throw new Error("Configure your Plaid backend URL first.");

  const linkToken = await createLinkToken(config);
  const module = plaidModule!;
  const session = await module.createPlaidLinkSession({
    token: linkToken,
    onSuccess: (success: LinkSuccess) => {
      void (async () => {
        const result = await postJson<ExchangeResult>(`${config.backendUrl.replace(/\/$/, "")}/exchange_public_token`, {
          publicToken: success.publicToken,
          accounts: success.metadata.accounts,
          institution: success.metadata.institution,
        });
        const accountNames = (result.accounts ?? success.metadata.accounts ?? []).map((a) => a.name ?? "Plaid account");
        for (const name of accountNames) {
          const existing = await accounts();
          if (existing.some((a) => a.name === name)) continue;
          await addAccount(name, "bank");
        }
        const accountId = (await accounts())[0]?.id ?? "";
        for (const tx of result.transactions ?? []) {
          const cents = Math.abs(Number(tx.amountCents ?? 0));
          if (!cents) continue;
          await addMoneyTransaction({
            date: tx.date ?? new Date().toISOString().slice(0, 10),
            merchant: tx.merchant ?? "Bank transaction",
            amountCents: cents,
            category: tx.category ?? "Uncategorised",
            kind: tx.kind === "income" ? "income" : "expense",
            accountId,
          });
        }
        await setConfig("plaid.lastImport", String((result.transactions ?? []).length));
      })().catch(() => undefined);
    },
    onExit: () => undefined,
    onEvent: () => undefined,
  });
  await session.open();
  return {
    imported: Number(await getConfig("plaid.lastImport") ?? 0),
    message: "Plaid Link completed. Exchange runs on your configured backend.",
  };
}
