// Pure helpers behind the Settings screen: which sections exist, and the one-line summaries
// shown on the collapsed rows. No React Native imports, so it runs in plain Node tests.

export const SETTINGS_SECTIONS = [
  { id: "data", title: "Account & data" },
  { id: "money", title: "Money" },
  { id: "groceries", title: "Groceries" },
  { id: "privacy", title: "Privacy & security" },
  { id: "about", title: "About" },
] as const;

export type SectionId = (typeof SETTINGS_SECTIONS)[number]["id"];

/** "https://financer.example.com:8443/api" -> "financer.example.com:8443"; the input if it is not an address. */
export function serverHost(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return "";
  try {
    return new URL(trimmed).host || trimmed;
  } catch {
    return trimmed;
  }
}

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
export function connectionState(i: ConnectionInput): ConnectionState {
  if (i.mode === "embedded") {
    if (!i.embeddedAvailable) return { tone: "bad", where: "This phone", status: "This build does not include the on-phone backend" };
    if (i.embeddedError) return { tone: "bad", where: "This phone", status: i.embeddedError };
    return { tone: i.settingsLoaded ? "ok" : "warn", where: "This phone", status: i.settingsLoaded ? "Running inside this app" : "Starting…" };
  }
  if (!i.hasConfig) return { tone: "off", where: "Server", status: "Not connected yet" };
  const host = serverHost(i.baseUrl ?? "");
  if (i.settingsError) return { tone: "bad", where: host || "Server", status: `Not reachable: ${i.settingsError}` };
  return { tone: i.settingsLoaded ? "ok" : "warn", where: host || "Server", status: i.settingsLoaded ? "Connected" : "Checking…" };
}

const HABIT_LABEL: Record<string, string> = { manual: "My own list", receipts: "Receipts", spending: "Estimate from spending" };

export function habitLabel(mode: string): string {
  return HABIT_LABEL[mode] ?? mode;
}

const PROVIDER_LABEL: Record<string, string> = { claude: "Claude", open_ai: "OpenAI" };

export function providerLabel(provider: string): string {
  return PROVIDER_LABEL[provider] ?? provider;
}

/** "Claude · key set" / "OpenAI · no key". */
export function aiSummary(provider: string, keyConfigured: boolean, model: string): string {
  const parts = [providerLabel(provider), keyConfigured ? "key set" : "no key"];
  if (model.trim()) parts.push(model.trim());
  return parts.join(" · ");
}

/** "3 price sources" / "1 price source" / "No price sources". */
export function priceSourcesLabel(n: number): string {
  return n === 0 ? "No price sources" : `${n} price source${n === 1 ? "" : "s"}`;
}

/** "2 of 3 on". */
export function onCountLabel(on: number, total: number): string {
  return `${on} of ${total} on`;
}

/** "Day 25" or "Calendar month". */
export function paydayLabel(day: number): string {
  return day === 1 ? "Calendar month" : `Day ${day}`;
}

// ---- bank sync form: hints only, the server has the last word ----

/** A German bank code (BLZ) is eight digits. `null` when it looks fine or nothing was typed. */
export function blzProblem(blz: string): string | null {
  const v = blz.trim();
  if (!v) return null;
  return /^\d{8}$/.test(v) ? null : "A bank code has 8 digits.";
}

/** ISO 7064 mod 97 check of an IBAN, spaces allowed. */
export function ibanChecksumOk(iban: string): boolean {
  const v = iban.replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(v)) return false;
  const rearranged = v.slice(4) + v.slice(0, 4);
  let rest = 0;
  for (const ch of rearranged) {
    const digits = ch >= "A" ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of digits) rest = (rest * 10 + Number(d)) % 97;
  }
  return rest === 1;
}

/** `null` when the IBAN looks fine or nothing was typed. */
export function ibanProblem(iban: string): string | null {
  const v = iban.replace(/\s+/g, "");
  if (!v) return null;
  return ibanChecksumOk(v) ? null : "This IBAN does not pass the check digits. Check it for typos.";
}
