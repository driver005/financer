import { getDb } from "./database";

export type Envelope = { id: number; name: string; balanceCents: number; limitCents: number; rollover: number; period: string };
export type ChecklistItem = { id: number; goalId: number; title: string; amountCents: number; completed: number; link: string };
export type Paycheck = { id: number; date: string; takeHomeCents: number };
export type Allocation = { id: number; paycheckId: number; label: string; cents: number; kind: string };
export type Invoice = { id: number; number: string; customer: string; totalCents: number; status: string };
export type InvoiceItem = { id: number; invoiceId: number; description: string; qty: number; cents: number };
export type Valuation = { id: number; accountId: string; date: string; valueCents: number; source: string };
export type Split = { id: number; receiptId: number; person: string; sharePercent: number };

export const envelopes = (): Promise<Envelope[]> => getDb().then((db) => db.getAllAsync<Envelope>("SELECT * FROM envelopes ORDER BY name"));
export const addEnvelope = (name: string, limitCents: number, rollover: boolean) =>
  getDb().then((db) => db.runAsync("INSERT INTO envelopes (name, limitCents, rollover) VALUES (?, ?, ?)", name, limitCents, rollover ? 1 : 0));
export const fundEnvelope = (id: number, cents: number) => getDb().then(async (db) => {
  await db.runAsync("UPDATE envelopes SET balanceCents = balanceCents + ? WHERE id = ?", cents, id);
  await db.runAsync("INSERT INTO envelope_funding (envelopeId, cents, date) VALUES (?, ?, ?)", id, cents, new Date().toISOString().slice(0, 10));
});

export const checklist = (goalId?: number): Promise<ChecklistItem[]> => getDb().then((db) =>
  goalId === undefined
    ? db.getAllAsync<ChecklistItem>("SELECT * FROM goal_checklist ORDER BY goalId, id")
    : db.getAllAsync<ChecklistItem>("SELECT * FROM goal_checklist WHERE goalId = ? ORDER BY id", goalId));
export const addChecklistItem = (goalId: number, title: string, amountCents: number, link: string) =>
  getDb().then((db) => db.runAsync("INSERT INTO goal_checklist (goalId, title, amountCents, link) VALUES (?, ?, ?, ?)", goalId, title, amountCents, link));
export const toggleChecklistItem = (id: number, completed: boolean) =>
  getDb().then((db) => db.runAsync("UPDATE goal_checklist SET completed = ? WHERE id = ?", completed ? 1 : 0, id));

export const paychecks = (): Promise<Paycheck[]> => getDb().then((db) => db.getAllAsync<Paycheck>("SELECT * FROM paychecks ORDER BY date DESC"));
export const allocations = (paycheckId?: number): Promise<Allocation[]> => getDb().then((db) =>
  paycheckId === undefined
    ? db.getAllAsync<Allocation>("SELECT * FROM paycheck_allocations ORDER BY paycheckId, id")
    : db.getAllAsync<Allocation>("SELECT * FROM paycheck_allocations WHERE paycheckId = ? ORDER BY id", paycheckId));
export const savePaycheck = async (date: string, takeHomeCents: number, rules: { label: string; cents: number; kind: string }[]) => {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    const result = await db.runAsync("INSERT INTO paychecks (date, takeHomeCents) VALUES (?, ?)", date, takeHomeCents);
    const id = Number(result.lastInsertRowId);
    for (const rule of rules) {
      await db.runAsync("INSERT INTO paycheck_allocations (paycheckId, label, cents, kind) VALUES (?, ?, ?, ?)", id, rule.label, rule.cents, rule.kind);
    }
  });
};

export const invoices = (): Promise<Invoice[]> => getDb().then((db) => db.getAllAsync<Invoice>("SELECT * FROM invoices ORDER BY id DESC"));
export const invoiceItems = (invoiceId: number): Promise<InvoiceItem[]> => getDb().then((db) => db.getAllAsync<InvoiceItem>("SELECT * FROM invoice_items WHERE invoiceId = ?", invoiceId));
export const saveInvoice = async (number: string, customer: string, totalCents: number, status: string, items: { description: string; qty: number; cents: number }[]) => {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    const result = await db.runAsync("INSERT INTO invoices (number, customer, totalCents, status) VALUES (?, ?, ?, ?)", number, customer, totalCents, status);
    const id = Number(result.lastInsertRowId);
    for (const item of items) await db.runAsync("INSERT INTO invoice_items (invoiceId, description, qty, cents) VALUES (?, ?, ?, ?)", id, item.description, item.qty, item.cents);
  });
};

export const valuations = (): Promise<Valuation[]> => getDb().then((db) => db.getAllAsync<Valuation>("SELECT * FROM account_valuations ORDER BY date"));
export const addValuation = (accountId: string, date: string, valueCents: number) =>
  getDb().then((db) => db.runAsync("INSERT INTO account_valuations (accountId, date, valueCents) VALUES (?, ?, ?)", accountId, date, valueCents));

export const splits = (receiptId: number): Promise<Split[]> => getDb().then((db) => db.getAllAsync<Split>("SELECT * FROM splits WHERE receiptId = ?", receiptId));
export const saveSplits = async (receiptId: number, people: { person: string; sharePercent: number }[]) => {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    await db.runAsync("DELETE FROM splits WHERE receiptId = ?", receiptId);
    for (const person of people) await db.runAsync("INSERT INTO splits (receiptId, person, sharePercent) VALUES (?, ?, ?)", receiptId, person.person, person.sharePercent);
  });
};
