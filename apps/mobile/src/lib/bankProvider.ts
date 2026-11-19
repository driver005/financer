/**
 * Real PSD2 bank connection via the GoCardless Bank Account Data API
 * (formerly Nordigen). Credentials are entered at runtime and stored in
 * Expo SecureStore — no keys are baked into the app.
 *
 * Docs: https://developer.gocardless.com/bank-account-data/endpoints
 */
import { Linking, Platform } from "react-native";
import { getConfig, setConfig, deleteConfig } from "./secureConfig";
import * as WebBrowser from "expo-web-browser";
import { accounts, addAccount } from "../db/moneyTracker";
import { addMoneyTransaction } from "../db/moneyTracker";

const BASE = "https://bankaccountdata.gocardless.com/api/v2";
const KEYS = {
  secretId: "gocardless.secretId",
  secretKey: "gocardless.secretKey",
  redirectUri: "gocardless.redirectUri",
  agreement: "gocardless.agreement",
  accessToken: "gocardless.accessToken",
} as const;

export type ProviderConfig = { secretId: string; secretKey: string; redirectUri: string; agreement: string };
export type Institution = { id: string; name: string; countries?: string[] };
export type LinkedBankAccount = { id: string; name: string; balanceCents: number };

let cachedToken: string | null = null;

export async function loadProviderConfig(): Promise<ProviderConfig> {
  const [secretId, secretKey, redirectUri, agreement] = await Promise.all([
    getConfig(KEYS.secretId),
    getConfig(KEYS.secretKey),
    getConfig(KEYS.redirectUri),
    getConfig(KEYS.agreement),
  ]);
  return {
    secretId: secretId ?? "",
    secretKey: secretKey ?? "",
    redirectUri: redirectUri ?? (Platform.OS === "web" ? window.location.origin : "pantry://bank-callback"),
    agreement: agreement ?? "",
  };
}

export async function saveProviderConfig(config: ProviderConfig) {
  await Promise.all([
    setConfig(KEYS.secretId, config.secretId),
    setConfig(KEYS.secretKey, config.secretKey),
    setConfig(KEYS.redirectUri, config.redirectUri),
    setConfig(KEYS.agreement, config.agreement),
  ]);
  cachedToken = null;
}

export async function clearProviderConfig() {
  await Promise.all(Object.values(KEYS).map((key) => deleteConfig(key)));
  cachedToken = null;
}

async function accessToken(): Promise<string> {
  if (cachedToken) return cachedToken;
  const { secretId, secretKey } = await loadProviderConfig();
  if (!secretId || !secretKey) throw new Error("Enter your GoCardless Secret ID and Secret Key first.");
  const response = await fetch(`${BASE}/token/new/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ secret_id: secretId, secret_key: secretKey }),
  });
  if (!response.ok) throw new Error(`Bank provider token request failed (${response.status}). Check your credentials.`);
  const data = await response.json() as { access: string; refresh?: string };
  cachedToken = data.access;
  return data.access;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await accessToken();
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) throw new Error(`Bank provider request failed (${response.status}) on ${path}.`);
  return response.json() as Promise<T>;
}

/** 4,000+ institutions across the EU/UK come from the provider, not a hardcoded list. */
export async function listInstitutions(country = "DE"): Promise<Institution[]> {
  const data = await api<{ id: string; name: string; countries?: string[] }[]>(`/institutions/?country=${country}`);
  return data.map((row) => ({ id: row.id, name: row.name, countries: row.countries }));
}

export async function createRequisition(institutionId: string) {
  const { redirectUri, agreement } = await loadProviderConfig();
  const data = await api<{ id: string; link: string; requisition_id?: string }>("/requisitions/", {
    method: "POST",
    body: JSON.stringify({
      redirect: redirectUri,
      institution_id: institutionId,
      reference: `pantry-${Date.now()}`,
      user_language: "EN",
      ...(agreement ? { agreement } : {}),
    }),
  });
  return { id: data.id, link: data.link };
}

/** Opens the real bank login in a secure in-app browser and waits for the redirect. */
export async function openBankLogin(link: string) {
  const { redirectUri } = await loadProviderConfig();
  const result = await WebBrowser.openAuthSessionAsync(link, redirectUri);
  const url = result.type === "success" ? result.url : "";
  const ref = url ? new URL(url).searchParams.get("ref") : null;
  return { cancelled: result.type === "cancel", ref };
}

type AccountDetails = { id: string; name: string; currency: string; accountType?: string };
type TransactionsResponse = { booked?: {
  bookingDate?: string; valueDate?: string;
  transactionAmount?: { amount?: string; currency?: string };
  remittanceInformationUnstructured?: string; creditorName?: string;
}[] };

/** Pulls accounts and booked transactions after consent and stores them locally. */
export async function importRequisition(requisitionId: string) {
  const requisition = await api<{ accounts?: string[] }>(`/requisitions/${requisitionId}/`);
  let imported = 0;
  for (const externalId of requisition.accounts ?? []) {
    const detail = await api<AccountDetails>(`/accounts/${externalId}/`);
    const name = `${detail.name || "Bank account"} (${detail.currency || "EUR"})`;
    const existing = await accounts();
    let accountId = existing.find((a) => a.name === name)?.id;
    if (!accountId) { await addAccount(name, "bank"); accountId = (await accounts()).find((a) => a.name === name)?.id; }
    if (!accountId) continue;

    const txs = await api<TransactionsResponse>(`/accounts/${externalId}/transactions/`);
    for (const tx of txs.booked ?? []) {
      const amount = Number(tx.transactionAmount?.amount ?? 0);
      if (!Number.isFinite(amount) || amount === 0) continue;
      const cents = Math.round(Math.abs(amount) * 100);
      await addMoneyTransaction({
        date: tx.bookingDate ?? tx.valueDate ?? new Date().toISOString().slice(0, 10),
        merchant: tx.remittanceInformationUnstructured || tx.creditorName || "Bank transaction",
        amountCents: cents,
        category: "Uncategorised",
        kind: amount > 0 ? "income" : "expense",
        accountId,
      });
      imported += 1;
    }
  }
  return { imported, accounts: (await accounts()).filter((a) => a.kind === "bank").length };
}

/** Web fallback when an in-app browser is unavailable. */
export function openBankLoginExternal(link: string) {
  return Linking.openURL(link);
}
