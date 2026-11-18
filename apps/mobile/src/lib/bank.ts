import type { BankProvider, Transaction } from "./types";
import { core } from "../rust/core";
import type { Store } from "./types";

export const BANK_PROVIDERS: BankProvider[] = [
  { id: "plaid", name: "Plaid", note: "Direct request from this device with your own keys and access token" },
  { id: "gocardless", name: "GoCardless", note: "Direct request from this device with an access token and account id" },
  { id: "csv", name: "CSV file", note: "Import a local bank export, nothing leaves the device" },
  { id: "manual", name: "Manual", note: "Add a transaction by hand" },
];

export type BankConfig = {
  plaidClientId: string;
  plaidSecret: string;
  plaidAccessToken: string;
  plaidEnv: "sandbox" | "development" | "production";
  gocardlessToken: string;
  gocardlessAccount: string;
};

export const EMPTY_BANK_CONFIG: BankConfig = {
  plaidClientId: "",
  plaidSecret: "",
  plaidAccessToken: "",
  plaidEnv: "sandbox",
  gocardlessToken: "",
  gocardlessAccount: "",
};

function plaidHost(env: BankConfig["plaidEnv"]): string {
  return env === "production" ? "https://api.plaid.com" : `https://${env}.plaid.com`;
}

/** Pull transactions straight from Plaid to this device. No app server, no relay. */
export async function pullPlaid(config: BankConfig, stores: Store[]): Promise<Transaction[]> {
  if (!config.plaidClientId || !config.plaidSecret || !config.plaidAccessToken) {
    throw new Error("Add Plaid client id, secret and access token in Settings first.");
  }
  const response = await fetch(`${plaidHost(config.plaidEnv)}/transactions/get`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: config.plaidClientId,
      secret: config.plaidSecret,
      access_token: config.plaidAccessToken,
      options: { days_requested: 365 },
    }),
  });
  if (!response.ok) throw new Error(`Plaid returned ${response.status}`);
  const data = (await response.json()) as {
    transactions?: { transaction_id: string; date: string; name: string; amount: number; category?: string[] }[];
  };
  return (data.transactions ?? []).map((row) => ({
    id: 0,
    date: row.date,
    merchant: row.name,
    amountCents: Math.round(row.amount * 100),
    category: row.category?.[0] ?? "uncategorised",
    storeId: core.matchStore(row.name, stores),
    source: "plaid",
    externalId: row.transaction_id,
  }));
}

/** Direct GoCardless / Nordigen account read, also from this device only. */
export async function pullGoCardless(config: BankConfig, stores: Store[]): Promise<Transaction[]> {
  if (!config.gocardlessToken || !config.gocardlessAccount) {
    throw new Error("Add a GoCardless access token and account id in Settings first.");
  }
  const response = await fetch(
    `https://bankaccountdata.gocardless.com/api/v2/accounts/${encodeURIComponent(config.gocardlessAccount)}/transactions/`,
    { headers: { Authorization: `Bearer ${config.gocardlessToken}` } },
  );
  if (!response.ok) throw new Error(`GoCardless returned ${response.status}`);
  const data = (await response.json()) as {
    transactions?: { booked?: { transactionId: string; bookingDate: string; remittanceInformationUnstructured?: string; transactionAmount?: { amount?: string } }[] }[];
  };
  const booked = data.transactions?.flatMap((t) => t.booked ?? []) ?? [];
  return booked.map((row) => {
    const merchant = row.remittanceInformationUnstructured || "Bank transaction";
    return {
      id: 0,
      date: row.bookingDate,
      merchant,
      amountCents: Math.abs(Math.round(Number(row.transactionAmount?.amount ?? 0) * 100)),
      category: "uncategorised",
      storeId: core.matchStore(merchant, stores),
      source: "gocardless",
      externalId: row.transactionId,
    };
  });
}
