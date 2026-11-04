/**
 * Pure logic for the bank sources on the Spending screen: what can be connected (a CSV file, FinTS,
 * Plaid, GoCardless, finAPI), what state each is in, which one the switcher shows first, and what
 * the guided setup writes into the server's settings. No React Native imports, so it runs in plain
 * Node tests.
 */
import type { BankConnection } from "./api/client";
import { isBusy, needsLinking, providerLabel } from "./bankConnections";
import { emptyRow, serverValue, wireValue, type ConfigChange, type ConfigKey, type ConfigView, type Row } from "./serverConfig";

export type SourceId = "csv" | "fints" | "gocardless" | "plaid" | "finapi";

export type Source = {
  id: SourceId;
  label: string;
  /** A MaterialCommunityIcons name. */
  icon: "file-delimited-outline" | "bank-transfer" | "bank-outline" | "link-variant" | "bank-check";
  /** One line in the menu. */
  blurb: string;
  /** What you need before it works. */
  needs: string;
};

/** In the order of the menu and the switcher. */
export const SOURCES: readonly Source[] = [
  { id: "csv", label: "CSV import", icon: "file-delimited-outline", blurb: "Import the export file of your bank. Works with every bank, nothing to set up.", needs: "A CSV export from your online banking." },
  { id: "fints", label: "Sparkasse (FinTS)", icon: "bank-transfer", blurb: "Talks to your bank directly. Every sync is approved in your banking app.", needs: "Your bank code, login and IBAN, and a FinTS product id on the server." },
  { id: "gocardless", label: "GoCardless", icon: "bank-outline", blurb: "Open banking: sign in once on your bank's page, then it syncs by itself.", needs: "GoCardless Bank Account Data keys. GoCardless takes no new sign-ups for it, so only an existing account works." },
  { id: "plaid", label: "Plaid", icon: "link-variant", blurb: "Sign in once on Plaid's page, then it syncs by itself.", needs: "Plaid keys from dashboard.plaid.com, with Hosted Link turned on." },
  { id: "finapi", label: "finAPI", icon: "bank-check", blurb: "Pick your bank and sign in once on finAPI's page, then it syncs by itself.", needs: "finAPI client keys. Needs a finAPI customer agreement." },
];

export function sourceInfo(id: SourceId): Source {
  return SOURCES.find((s) => s.id === id) ?? SOURCES[0];
}

/** The providers that sign in once on their own page. */
export function linksOnceSource(id: SourceId): boolean {
  return id === "gocardless" || id === "plaid" || id === "finapi";
}

/** The connections of one source (`csv` has none). */
export function connectionsOf(list: BankConnection[], id: SourceId): BankConnection[] {
  return id === "csv" ? [] : list.filter((c) => c.kind === id);
}

/** No bank connection is set up at all: the Spending screen offers "Set up". */
export function needsSetup(list: BankConnection[]): boolean {
  return list.length === 0;
}

/** A few words under a source's chip or in the menu: what state it is in. */
export function sourceStatus(list: BankConnection[], id: SourceId): string {
  if (id === "csv") return "Always available";
  const mine = connectionsOf(list, id);
  if (mine.length === 0) return "Not set up";
  const busy = mine.find(isBusy);
  if (busy) return busy.state === "needs_link" ? "Sign in to your bank" : "Syncing";
  const unlinked = mine.filter(needsLinking).length;
  if (unlinked > 0) return unlinked === mine.length ? "Not connected yet" : `${mine.length - unlinked} of ${mine.length} connected`;
  return mine.length === 1 ? "Connected" : `${mine.length} connected`;
}

/** The source the switcher opens on: the one synced most recently, else the first set up, else CSV. */
export function defaultSource(list: BankConnection[]): SourceId {
  if (list.length === 0) return "csv";
  const synced = [...list].filter((c) => c.last_sync_at != null).sort((a, b) => (b.last_sync_at ?? 0) - (a.last_sync_at ?? 0))[0];
  const pick = synced ?? list[0];
  return SOURCES.some((s) => s.id === pick.kind) ? (pick.kind as SourceId) : "csv";
}

/** The text of the main button of a source's panel. */
export function panelActionLabel(c: BankConnection, starting: boolean): string {
  if (starting) return needsLinking(c) ? "Opening…" : "Starting…";
  return needsLinking(c) ? `Connect via ${providerLabel(c)}` : "Sync now";
}

// ---------------------------------------------------------------- the guided setup

/** One thing the setup asks for. `path` is the server setting; fields without one belong to the account. */
export type SetupField = {
  id: string;
  label: string;
  help?: string;
  placeholder?: string;
  secret?: boolean;
  /** A choice between a few values. */
  options?: readonly string[];
  path?: string;
};

const NAME_FIELD: SetupField = { id: "name", label: "Name", help: "Shown in the app, for example Girokonto.", placeholder: "Girokonto" };

const KEY_FIELDS: Record<"gocardless" | "plaid" | "finapi", SetupField[]> = {
  gocardless: [
    { id: "secret_id", path: "bank.gocardless.secret_id", label: "GoCardless secret id", secret: true },
    { id: "secret_key", path: "bank.gocardless.secret_key", label: "GoCardless secret key", secret: true },
  ],
  plaid: [
    { id: "client_id", path: "bank.plaid.client_id", label: "Plaid client id", secret: true },
    { id: "secret", path: "bank.plaid.secret", label: "Plaid secret", secret: true },
    { id: "environment", path: "bank.plaid.environment", label: "Environment", help: "sandbox is Plaid's test bank; production is for your real bank.", options: ["sandbox", "production"] },
  ],
  finapi: [
    { id: "client_id", path: "bank.finapi.client_id", label: "finAPI client id", secret: true },
    { id: "client_secret", path: "bank.finapi.client_secret", label: "finAPI client secret", secret: true },
    { id: "environment", path: "bank.finapi.environment", label: "Environment", help: "sandbox is finAPI's test banks; live is for your real bank.", options: ["sandbox", "live"] },
  ],
};

const INSTITUTION_FIELD: SetupField = {
  id: "institution",
  label: "Bank (institution id)",
  help: "The GoCardless id of your bank from its institutions list, for example SPARKASSE_...",
  placeholder: "SPARKASSE_...",
};

function keyOf(view: ConfigView, path: string): ConfigKey | undefined {
  return view.groups.flatMap((g) => g.keys).find((k) => k.path === path);
}

/** True when the server already has this key (from the file, the app or the environment). */
function haveKey(view: ConfigView, path: string): boolean {
  return keyOf(view, path)?.is_set === true;
}

/**
 * What to ask for a source. Keys the server already has are not asked again, and a key that an
 * environment variable decides cannot be changed from the app anyway.
 */
export function setupFields(view: ConfigView, id: SourceId): SetupField[] {
  if (!linksOnceSource(id)) return [];
  const provider = id as "gocardless" | "plaid" | "finapi";
  const keys = KEY_FIELDS[provider].filter((f) => {
    const key = f.path ? keyOf(view, f.path) : undefined;
    if (!key) return true;
    if (key.locked) return false;
    // the environment choice has a default, so it is always "set": ask for it only with fresh keys
    if (f.options) return KEY_FIELDS[provider].filter((k) => k.secret).some((k) => !haveKey(view, k.path ?? ""));
    return !key.is_set;
  });
  return [NAME_FIELD, ...(provider === "gocardless" ? [INSTITUTION_FIELD] : []), ...keys];
}

export type SetupValues = Record<string, string>;

/** The starting values: the first choice of every option field, the rest empty. */
export function setupDefaults(fields: SetupField[]): SetupValues {
  const values: SetupValues = {};
  for (const f of fields) values[f.id] = f.options ? f.options[0] : "";
  return values;
}

/** What is missing or wrong, by field id; empty when the form can be saved. */
export function setupProblems(view: ConfigView, id: SourceId, values: SetupValues): Record<string, string> {
  const problems: Record<string, string> = {};
  for (const f of setupFields(view, id)) {
    if (f.options) continue;
    if (!(values[f.id] ?? "").trim()) problems[f.id] = `${f.label} is needed`;
  }
  const name = (values.name ?? "").trim();
  if (name) {
    if (name.length > 60) problems.name = "At most 60 characters";
    const accounts = keyOf(view, "bank.accounts");
    const taken = accounts && Array.isArray(accounts.value) ? accounts.value.some((r) => String((r as Record<string, unknown>).name ?? "").trim().toLowerCase() === name.toLowerCase()) : false;
    if (taken) problems.name = "A connection with this name exists already";
  }
  const institution = (values.institution ?? "").trim();
  if (institution && !/^[A-Za-z0-9_-]{1,100}$/.test(institution)) problems.institution = "Letters, digits, - and _ only";
  return problems;
}

/** The request that saves the setup: the provider's keys, and the new connection added to the accounts. */
export function setupChange(view: ConfigView, id: SourceId, values: SetupValues): ConfigChange {
  const set: Record<string, unknown> = {};
  for (const f of setupFields(view, id)) {
    if (!f.path) continue;
    const v = (values[f.id] ?? "").trim();
    if (v) set[f.path] = v;
  }
  const accounts = keyOf(view, "bank.accounts");
  if (accounts) {
    const existing = serverValue(accounts) as Row[];
    const row = { ...emptyRow(accounts), name: (values.name ?? "").trim(), kind: id, sync_every_hours: "12" } as Row;
    if (id === "gocardless") row.institution = (values.institution ?? "").trim();
    set["bank.accounts"] = wireValue(accounts, [...existing, row]);
  }
  return { set, reset: [] };
}

/** Whether the server's settings can be changed from the app at all, and if not, why. */
export function setupBlocked(view: ConfigView | null, id: SourceId): string | null {
  if (!linksOnceSource(id)) return null;
  if (!view) return "Could not read the server's settings.";
  if (!view.writable) return "The server cannot write its settings file, so the app cannot set this up. Use financer.toml on the server instead.";
  const accounts = keyOf(view, "bank.accounts");
  if (!accounts) return "This server is too old to set up a bank from the app.";
  if (accounts.locked) return "The bank accounts are set by an environment variable on the server, so the app cannot add one.";
  return null;
}
