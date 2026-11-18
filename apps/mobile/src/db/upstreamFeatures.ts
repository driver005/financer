import { getDb } from "./database";

export type Gold = { id: number; name: string; grams: number; buyCentsPerGram: number; currentCentsPerGram: number };
export type Receivable = { id: number; name: string; totalCents: number; paidCents: number; dueDate: string };
export type Subscription = { id: number; name: string; amountCents: number; interval: string; startDate: string; taxPercent: number };
export type ChatLog = { id: number; command: string; resultJson: string; createdAt: number };
export type OcrReceipt = { id: number; uri: string; merchant: string; amountCents: number; itemsJson: string; createdAt: number };
export type PaymentMethod = { id: number; name: string; kind: string };
export type ProjectGroup = { id: number; name: string };
export type Project = { id: number; groupId: number; name: string; targetCents: number };
export type ProjectPurchase = { id: number; projectId: number; name: string; cents: number; funded: number };
export type CreditCommitment = { id: number; name: string; balanceCents: number; monthlyCents: number; aprPercent: number };

const all = <T>(table: string, order = "id"): Promise<T[]> => getDb().then((db) => db.getAllAsync<T>(`SELECT * FROM ${table} ORDER BY ${order}`));

export const gold = () => all<Gold>("gold_holdings");
export const addGold = (name: string, grams: number, buy: number, current: number) =>
  getDb().then((db) => db.runAsync("INSERT INTO gold_holdings (name, grams, buyCentsPerGram, currentCentsPerGram) VALUES (?, ?, ?, ?)", name, grams, buy, current));

export const receivables = () => all<Receivable>("receivables");
export const addReceivable = (name: string, totalCents: number, dueDate: string) =>
  getDb().then((db) => db.runAsync("INSERT INTO receivables (name, totalCents, paidCents, dueDate) VALUES (?, ?, 0, ?)", name, totalCents, dueDate));
export const payReceivable = (id: number, cents: number) =>
  getDb().then((db) => db.runAsync("UPDATE receivables SET paidCents = paidCents + ? WHERE id = ?", cents, id));

export const subscriptions = () => all<Subscription>("subscriptions");
export const addSubscription = (name: string, amountCents: number, interval: string, startDate: string, taxPercent: number) =>
  getDb().then((db) => db.runAsync("INSERT INTO subscriptions (name, amountCents, interval, startDate, taxPercent) VALUES (?, ?, ?, ?, ?)", name, amountCents, interval, startDate, taxPercent));

export const chatLogs = (): Promise<ChatLog[]> => all<ChatLog>("chat_log", "createdAt DESC");
export const logCommand = (command: string, resultJson: string) =>
  getDb().then((db) => db.runAsync("INSERT INTO chat_log (command, resultJson, createdAt) VALUES (?, ?, ?)", command, resultJson, Date.now()));

export const ocrReceipts = (): Promise<OcrReceipt[]> => all<OcrReceipt>("ocr_receipts", "createdAt DESC");
export const addOcrReceipt = (merchant: string, amountCents: number, itemsJson: string, uri = "") =>
  getDb().then((db) => db.runAsync("INSERT INTO ocr_receipts (uri, merchant, amountCents, itemsJson, createdAt) VALUES (?, ?, ?, ?, ?)", uri, merchant, amountCents, itemsJson, Date.now()));

export const invoicePayments = () => getDb().then((db) => db.getAllAsync<{ id: number; invoiceId: number; methodId: number; cents: number; proofUri: string; status: string }>("SELECT * FROM invoice_payments ORDER BY id"));
export const addInvoicePayment = (invoiceId: number, methodId: number, cents: number, proofUri = "") =>
  getDb().then((db) => db.runAsync("INSERT INTO invoice_payments (invoiceId, methodId, cents, proofUri, status) VALUES (?, ?, ?, ?, 'pending')", invoiceId, methodId, cents, proofUri));
export const approveInvoicePayment = (id: number) => getDb().then((db) => db.runAsync("UPDATE invoice_payments SET status = 'approved' WHERE id = ?", id));

export const paymentMethods = () => all<PaymentMethod>("payment_methods");
export const addPaymentMethod = (name: string, kind: string) =>
  getDb().then((db) => db.runAsync("INSERT INTO payment_methods (name, kind) VALUES (?, ?)", name, kind));

export const projectGroups = () => all<ProjectGroup>("project_groups");
export const projects = () => all<Project>("projects");
export const projectPurchases = (): Promise<ProjectPurchase[]> => all<ProjectPurchase>("project_purchases");
export const addProjectGroup = (name: string) => getDb().then((db) => db.runAsync("INSERT INTO project_groups (name) VALUES (?)", name));
export const addProject = (groupId: number, name: string, targetCents: number) =>
  getDb().then((db) => db.runAsync("INSERT INTO projects (groupId, name, targetCents) VALUES (?, ?, ?)", groupId, name, targetCents));
export const addProjectPurchase = (projectId: number, name: string, cents: number, funded: boolean) =>
  getDb().then((db) => db.runAsync("INSERT INTO project_purchases (projectId, name, cents, funded) VALUES (?, ?, ?, ?)", projectId, name, cents, funded ? 1 : 0));

export const billConfirmations = () => getDb().then((db) => db.getAllAsync<{ id: number; billCents: number; paidCents: number; resultJson: string }>("SELECT * FROM bill_confirmations ORDER BY createdAt DESC"));
export const saveBillConfirmation = (billCents: number, paidCents: number, resultJson: string) =>
  getDb().then((db) => db.runAsync("INSERT INTO bill_confirmations (billCents, paidCents, resultJson, createdAt) VALUES (?, ?, ?, ?)", billCents, paidCents, resultJson, Date.now()));

export const creditCommitments = () => all<CreditCommitment>("credit_commitments");
export const addCreditCommitment = (name: string, balanceCents: number, monthlyCents: number, aprPercent: number) =>
  getDb().then((db) => db.runAsync("INSERT INTO credit_commitments (name, balanceCents, monthlyCents, aprPercent) VALUES (?, ?, ?, ?)", name, balanceCents, monthlyCents, aprPercent));

export const goalFundings = (goalId: number) => getDb().then((db) => db.getAllAsync<{ id: number; goalId: number; cents: number; date: string }>("SELECT * FROM goal_funding WHERE goalId = ? ORDER BY date", goalId));
export const fundGoal = (goalId: number, cents: number) => getDb().then(async (db) => {
  await db.runAsync("UPDATE savings_goals SET savedCents = savedCents + ? WHERE id = ?", cents, goalId);
  await db.runAsync("INSERT INTO goal_funding (goalId, cents, date) VALUES (?, ?, ?)", goalId, cents, new Date().toISOString().slice(0, 10));
});
export const setGoalPaused = (id: number, paused: boolean) => getDb().then((db) => db.runAsync("UPDATE savings_goals SET paused = ? WHERE id = ?", paused ? 1 : 0, id));
export const setRecurringRule = (id: number, frequency: string, count: number, startDate: string) =>
  getDb().then((db) => db.runAsync("UPDATE recurring SET frequency = ?, count = ?, startDate = ? WHERE id = ?", frequency, count, startDate, id));
export const setOcrPhotos = (id: number, photosJson: string) => getDb().then((db) => db.runAsync("UPDATE ocr_receipts SET photosJson = ? WHERE id = ?", photosJson, id));
export const setCategoryMeta = (name: string, type: string, archived: boolean) =>
  getDb().then((db) => db.runAsync("UPDATE categories SET type = ?, archived = ? WHERE name = ?", type, archived ? 1 : 0, name));
export const setAccountFees = (id: string, cents: number) => getDb().then((db) => db.runAsync("UPDATE accounts SET feesCents = ? WHERE id = ?", cents, id));

export const onboardingDone = async (): Promise<boolean> => {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string }>("SELECT value FROM onboarding_state WHERE key = 'done'");
  return row?.value === "1";
};
export const completeOnboarding = async () => {
  const db = await getDb();
  await db.runAsync("INSERT INTO onboarding_state (key, value) VALUES ('done', '1') ON CONFLICT(key) DO UPDATE SET value = '1'");
};
