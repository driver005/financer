// The Settings screen: which sections exist (here) and the one-line summaries shown on the collapsed
// rows, the connection status and the bank form hints (Rust: crates/logic, settings_plan.rs).
import { logic } from "../../../packages/wire/src/logic";

export const SETTINGS_SECTIONS = [
  { id: "data", title: "Account & data" },
  { id: "money", title: "Money" },
  { id: "groceries", title: "Groceries" },
  { id: "privacy", title: "Privacy & security" },
  { id: "about", title: "About" },
] as const;

export type SectionId = (typeof SETTINGS_SECTIONS)[number]["id"];

/** "https://financer.example.com:8443/api" -> "financer.example.com:8443"; the input if it is not an address. */
export const serverHost = (url: string): string => logic("settings_plan.server_host", { url });

export type ConnectionInput = {
  mode: "remote" | "embedded";
  /** A saved server address and token exists. */
  hasConfig: boolean;
  baseUrl?: string;
  embeddedAvailable: boolean;
  embeddedError: string | null;
  /** The settings request answered (the server is reachable and the token works). */
  settingsLoaded: boolean;
  /** The message of the failed settings request, if it failed. */
  settingsError: string | null;
};

export type ConnectionState = {
  tone: "ok" | "warn" | "bad" | "off";
  /** Short, goes on the row ("Server", "This phone"). */
  where: string;
  /** What is going on, in plain words. */
  status: string;
};

/** Read-only connection status for the top of Account & data. */
export const connectionState = (i: ConnectionInput): ConnectionState => logic("settings_plan.connection_state", { i });

export const habitLabel = (mode: string): string => logic("settings_plan.habit_label", { mode });

export const providerLabel = (provider: string): string => logic("settings_plan.provider_label", { provider });

/** "Claude · key set" / "OpenAI · no key". */
export const aiSummary = (provider: string, keyConfigured: boolean, model: string): string =>
  logic("settings_plan.ai_summary", { provider, key_configured: keyConfigured, model });

/** "3 price sources" / "1 price source" / "No price sources". */
export const priceSourcesLabel = (n: number): string => logic("settings_plan.price_sources_label", { n });

/** "2 of 3 on". */
export const onCountLabel = (on: number, total: number): string => logic("settings_plan.on_count_label", { on, total });

/** "Day 25" or "Calendar month". */
export const paydayLabel = (day: number): string => logic("settings_plan.payday_label", { day });

// ---- bank sync form: hints only, the server has the last word ----

/** A German bank code (BLZ) is eight digits. `null` when it looks fine or nothing was typed. */
export const blzProblem = (blz: string): string | null => logic("settings_plan.blz_problem", { blz });

/** ISO 7064 mod 97 check of an IBAN, spaces allowed. */
export const ibanChecksumOk = (iban: string): boolean => logic("settings_plan.iban_checksum_ok", { iban });

/** `null` when the IBAN looks fine or nothing was typed. */
export const ibanProblem = (iban: string): string | null => logic("settings_plan.iban_problem", { iban });
