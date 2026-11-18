import { db } from "./db.server";
import {
  getUsdIdr,
  insertTransaction,
  updateTransaction,
  ensureCategory,
  isMissingTable,
  logActivity,
  today,
} from "./finance.server";
import {
  goldHoldings,
  goldLinkAction,
  goldLinkedTx,
  GOLD_CATEGORY,
  GOLD_LINK_COLUMNS,
  receivableStatus,
  TROY_OUNCE_GRAMS,
  type GoldPrice,
} from "./assets";
import type { GoldInput, ReceivableInput } from "./schemas";
import { fetchAll } from "./paginate";
import type { Tables } from "./database.types";

type GoldPriceRow = Pick<
  Tables<"gold_prices">,
  "price_date" | "source" | "buy" | "buyback" | "estimated"
>;

/* eslint-disable @typescript-eslint/no-explicit-any */
const ANTAM_PREMIUM = 1.12; // fallback estimate when no Antam price is reachable
const ANTAM_BUYBACK_RATIO = 0.9;

async function fetchText(url: string, ms = 6000): Promise<string | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(ms),
      headers: { "user-agent": "Mozilla/5.0 Dompetku" },
    });
    return res.ok ? await res.text() : null;
  } catch (e) {
    console.error("fetch failed", url, e);
    return null;
  }
}

/** World XAU spot (USD/oz) converted to IDR per gram. */
async function fetchWorld(): Promise<{ buy: number; buyback: number } | null> {
  const txt = await fetchText("https://api.gold-api.com/price/XAU");
  const usdOz = Number(txt ? (JSON.parse(txt) as any)?.price : NaN);
  if (!(usdOz > 0)) return null;
  const perGram = Math.round((usdOz * (await getUsdIdr())) / TROY_OUNCE_GRAMS);
  return { buy: perGram, buyback: perGram };
}

const rupiah = (s: string) => Number(s.replace(/[^\d]/g, ""));

/** Antam 1 gram price from public pages. Returns null when parsing fails. */
async function fetchAntam(): Promise<{ buy: number; buyback: number } | null> {
  const html = await fetchText("https://www.logammulia.com/id/harga-emas-hari-ini");
  let buy = 0;
  let buyback = 0;
  if (html) {
    const m = html.match(/>\s*1\s*gr\s*<\/td>\s*<td[^>]*>\s*([\d.,]+)/i);
    if (m) buy = rupiah(m[1]!);
  }
  const bb = await fetchText("https://www.logammulia.com/id/sell/gold");
  if (bb) {
    const m = bb.match(/Harga\s*Buyback[^R]*Rp\s*([\d.,]+)/i);
    if (m) buyback = rupiah(m[1]!);
  }
  const ok = (n: number) => n > 300_000 && n < 20_000_000;
  if (!ok(buy) && !ok(buyback)) return null;
  return {
    buy: ok(buy) ? buy : Math.round(buyback / ANTAM_BUYBACK_RATIO),
    buyback: ok(buyback) ? buyback : Math.round(buy * ANTAM_BUYBACK_RATIO),
  };
}

async function cached(
  source: "world" | "antam",
): Promise<{ row: GoldPriceRow | null; ready: boolean }> {
  const res = await db()
    .from("gold_prices")
    .select("price_date, source, buy, buyback, estimated")
    .eq("source", source)
    .order("price_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (res.error) return { row: null, ready: !isMissingTable(res.error) };
  return { row: res.data, ready: true };
}

const toPrice = (r: GoldPriceRow, source: "world" | "antam"): GoldPrice => ({
  source,
  date: String(r.price_date),
  buy: Number(r.buy),
  buyback: Number(r.buyback),
  estimated: !!r.estimated,
});

/** Both reference prices, cached once per day in gold_prices; safe fallbacks when sources fail. */
export async function getGoldPrices(): Promise<{
  world: GoldPrice | null;
  antam: GoldPrice | null;
}> {
  const d = today();
  const [w, a] = await Promise.all([cached("world"), cached("antam")]);
  let world = w.row && String(w.row.price_date) === d ? toPrice(w.row, "world") : null;
  let antam =
    a.row && String(a.row.price_date) === d && !a.row.estimated ? toPrice(a.row, "antam") : null;
  const [fw, fa] = await Promise.all([world ? null : fetchWorld(), antam ? null : fetchAntam()]);
  if (!world) {
    if (fw) {
      world = { source: "world", date: d, ...fw, estimated: false };
      if (w.ready)
        await db().from("gold_prices").upsert({
          price_date: d,
          source: "world",
          buy: fw.buy,
          buyback: fw.buyback,
          estimated: false,
        });
    } else if (w.row) world = toPrice(w.row, "world");
  }
  if (!antam) {
    if (fa) {
      antam = { source: "antam", date: d, ...fa, estimated: false };
      if (a.ready)
        await db().from("gold_prices").upsert({
          price_date: d,
          source: "antam",
          buy: fa.buy,
          buyback: fa.buyback,
          estimated: false,
        });
    } else if (a.row) antam = toPrice(a.row, "antam");
    else if (world)
      antam = {
        source: "antam",
        date: d,
        buy: Math.round(world.buy * ANTAM_PREMIUM),
        buyback: Math.round(world.buy * ANTAM_PREMIUM * ANTAM_BUYBACK_RATIO),
        estimated: true,
      };
  }
  return { world, antam };
}

type GoldListOptions = {
  offset?: number;
  limit?: number;
  sort?: "occurred_at" | "grams" | "price_per_gram" | "total";
  direction?: "asc" | "desc";
  account?: string | undefined;
};

export async function goldSummary(options: GoldListOptions = {}) {
  const offset = options.offset ?? 0;
  const limit = options.limit ?? 25;
  const base = "id, kind, occurred_at, grams, price_per_gram, total, place, notes";
  const run = (columns: string) => {
    let q: any = db()
      .from("gold_purchases")
      .select(columns, { count: "exact" })
      .order(options.sort ?? "occurred_at", { ascending: (options.direction ?? "desc") === "asc" });
    if (options.account) q = q.eq("account_id", options.account);
    return q.range(offset, offset + limit - 1);
  };
  let res = await run(`${base}, gold_type, product_number, account_id, transaction_id`);
  if (res.error && /account_id|transaction_id/i.test(res.error.message))
    res = await run(`${base}, gold_type, product_number`);
  if (res.error && /gold_type|product_number/i.test(res.error.message)) res = await run(base);
  if (res.error) {
    if (isMissingTable(res.error)) return { ready: false as const };
    throw new Error(res.error.message);
  }
  // Holdings need every row (PostgREST caps responses at 1000); prices are independent, so load both together.
  const [all, prices] = await Promise.all([
    fetchAll((from, to) => {
      let q: any = db()
        .from("gold_purchases")
        .select("kind, grams, price_per_gram, total")
        .order("occurred_at", { ascending: false })
        .order("id");
      if (options.account) q = q.eq("account_id", options.account);
      return q.range(from, to);
    }),
    getGoldPrices(),
  ]);
  if (all.error) throw new Error(all.error.message);
  const rows = (res.data ?? []).map((r: any) => ({
    ...r,
    grams: Number(r.grams),
    price_per_gram: Number(r.price_per_gram),
    total: Number(r.total),
  }));
  const holdingsRows = (all.data ?? []).map((r: any) => ({
    ...r,
    grams: Number(r.grams),
    price_per_gram: Number(r.price_per_gram),
    total: Number(r.total),
  }));
  return {
    ready: true as const,
    rows,
    total: res.count ?? rows.length,
    holdings: goldHoldings(holdingsRows),
    prices,
  };
}

/** Save a gold record and keep its linked "Emas" transaction in sync (create/update/delete). */
export async function saveGold(id: string | null, v: GoldInput) {
  let prevTx: string | null = null;
  let linkReady = true;
  if (id) {
    const prev = await db()
      .from("gold_purchases")
      .select("transaction_id")
      .eq("id", id)
      .maybeSingle();
    if (prev.error && /transaction_id/i.test(prev.error.message)) linkReady = false;
    else prevTx = prev.data?.transaction_id ?? null;
  }
  const link = linkReady ? goldLinkedTx(v) : null;
  const action = linkReady ? goldLinkAction(prevTx, v.account_id) : "none";
  let transaction_id = prevTx;
  let created: string | null = null;
  if (link && (action === "create" || action === "update")) {
    const cat = await ensureCategory(GOLD_CATEGORY, link.kind);
    const input = {
      ...link,
      currency: "IDR" as const,
      to_account_id: null,
      category_id: cat,
      merchant: null,
      source: "web",
      items: null,
      receipt_path: null,
    };
    if (action === "update" && prevTx) await updateTransaction(prevTx, input as any);
    else {
      created = (await insertTransaction(input as any)).id;
      transaction_id = created;
    }
  }
  if (action === "delete") transaction_id = null;
  const optional = ["gold_type", "product_number", ...GOLD_LINK_COLUMNS];
  const run = (row: any) =>
    (id
      ? db().from("gold_purchases").update(row).eq("id", id)
      : db().from("gold_purchases").insert(row)
    )
      .select()
      .single();
  let res = await run({ ...v, transaction_id });
  if (res.error && optional.some((c) => res.error!.message.includes(c))) {
    // Older database without v5/v6 columns: undo the new link and save the plain record.
    if (created) await db().from("transactions").delete().eq("id", created);
    created = null;
    const row: any = { ...v };
    for (const c of optional) delete row[c];
    res = await run(row);
    if (!res.error) return res.data;
  }
  if (res.error) {
    if (created) await db().from("transactions").delete().eq("id", created);
    throw new Error(res.error.message);
  }
  if (action === "delete" && prevTx) await db().from("transactions").delete().eq("id", prevTx);
  return res.data;
}

/** Grams held at end of each month key (YYYY-MM) — used by net worth. */
export async function goldGramsByMonth(): Promise<{ month: string; grams: number }[]> {
  const res = await fetchAll((from, to) =>
    db().from("gold_purchases").select("kind, occurred_at, grams").order("id").range(from, to),
  );
  if (res.error) return [];
  return (res.data ?? []).map((r) => ({
    month: String(r.occurred_at).slice(0, 7),
    grams: (r.kind === "sell" ? -1 : 1) * Number(r.grams),
  }));
}

/* ---------------- Receivables ---------------- */
export async function listReceivables(
  options: { offset?: number; limit?: number; account?: string | undefined } = {},
) {
  const offset = options.offset ?? 0;
  const limit = options.limit ?? 24;
  const [r, p, outstanding] = await Promise.all([
    (() => {
      let q: any = db()
        .from("receivables")
        .select("*", { count: "exact" })
        .order("lent_at", { ascending: false });
      if (options.account) q = q.eq("account_id", options.account);
      return q.range(offset, offset + limit - 1);
    })(),
    fetchAll((from, to) =>
      db()
        .from("receivable_payments")
        .select("id, receivable_id, amount, paid_at, account_id")
        .order("paid_at")
        .order("id")
        .range(from, to),
    ),
    fetchAll((from, to) => {
      let q: any = db()
        .from("receivables")
        .select("id, amount, currency, status")
        .eq("status", "active")
        .order("id");
      if (options.account) q = q.eq("account_id", options.account);
      return q.range(from, to);
    }),
  ]);
  if (r.error || p.error) {
    if (isMissingTable(r.error) || isMissingTable(p.error)) return { ready: false as const };
    throw new Error((r.error ?? p.error)!.message);
  }
  const items = (r.data ?? []).map((x: any) => {
    const payments = (p.data ?? [])
      .filter((y: any) => y.receivable_id === x.id)
      .map((y: any) => ({ ...y, amount: Number(y.amount) }));
    return {
      ...x,
      amount: Number(x.amount),
      payments,
      ...receivableStatus(Number(x.amount), payments),
    };
  });
  const outstandingRows = (outstanding.data ?? []).map((x: any) => {
    const paid = (p.data ?? [])
      .filter((y: any) => y.receivable_id === x.id)
      .reduce((a: number, y: any) => a + Number(y.amount), 0);
    return { currency: String(x.currency), remaining: Math.max(0, Number(x.amount) - paid) };
  });
  const outstandingIdr = outstandingRows
    .filter((x) => x.currency === "IDR")
    .reduce((sum, x) => sum + x.remaining, 0);
  return {
    ready: true as const,
    items,
    total: r.count ?? items.length,
    outstandingIdr,
    outstandingRows,
  };
}

export async function saveReceivable(id: string | null, v: ReceivableInput) {
  if (id) {
    const res = await db().from("receivables").update(v).eq("id", id).select().single();
    if (res.error) throw new Error(res.error.message);
    await logActivity("receivables.update", "receivables", {
      name: v.name,
      amount: v.amount,
      currency: v.currency,
    });
    return res.data;
  }
  let transaction_id: string | null = null;
  if (v.account_id) {
    const cat = await ensureCategory("Piutang", "expense");
    const tx = await insertTransaction({
      kind: "expense",
      amount: v.amount,
      currency: v.currency,
      account_id: v.account_id,
      to_account_id: null,
      category_id: cat,
      description: `Pinjaman ke ${v.borrower ?? v.name}`,
      merchant: null,
      occurred_at: v.lent_at,
      source: "web",
      items: null,
      notes: v.notes,
      receipt_path: null,
    });
    transaction_id = tx.id;
  }
  const res = await db()
    .from("receivables")
    .insert({ ...v, transaction_id })
    .select()
    .single();
  if (res.error) throw new Error(res.error.message);
  await logActivity("receivables.create", "receivables", {
    name: v.name,
    amount: v.amount,
    currency: v.currency,
  });
  return res.data;
}

export async function payReceivable(
  id: string,
  amount: number,
  accountId: string | null,
  date: string | null,
) {
  const r = await db().from("receivables").select("*").eq("id", id).single();
  if (r.error) throw new Error(r.error.message);
  const rec = r.data;
  const paidAt = date ?? today();
  const acc = accountId ?? rec.account_id ?? null;
  let transaction_id: string | null = null;
  if (acc) {
    const cat = await ensureCategory("Piutang", "income");
    const tx = await insertTransaction({
      kind: "income",
      amount,
      currency: rec.currency,
      account_id: acc,
      to_account_id: null,
      category_id: cat,
      description: `Pembayaran piutang ${rec.borrower ?? rec.name}`,
      merchant: null,
      occurred_at: paidAt,
      source: "web",
      items: null,
      notes: null,
      receipt_path: null,
    });
    transaction_id = tx.id;
  }
  const ins = await db()
    .from("receivable_payments")
    .insert({ receivable_id: id, amount, paid_at: paidAt, account_id: acc, transaction_id });
  if (ins.error) throw new Error(ins.error.message);
  const pays = await db().from("receivable_payments").select("amount").eq("receivable_id", id);
  const paid = (pays.data ?? []).reduce((a, x) => a + Number(x.amount), 0);
  if (paid >= Number(rec.amount))
    await db().from("receivables").update({ status: "paid" }).eq("id", id);
  await logActivity("receivable.pay", "receivables", {
    name: rec.name,
    amount,
    currency: rec.currency,
  });
  return { ok: true };
}

export async function setReceivableStatus(id: string, status: "active" | "paid") {
  const res = await db()
    .from("receivables")
    .update({ status })
    .eq("id", id)
    .select("name, amount, currency")
    .single();
  if (res.error) throw new Error(res.error.message);
  await logActivity(
    status === "paid" ? "receivable.settle" : "receivable.reopen",
    "receivables",
    res.data,
  );
  return { ok: true };
}

export async function deleteReceivablePayment(id: string) {
  const p = await db().from("receivable_payments").select("*").eq("id", id).single();
  if (p.error) throw new Error(p.error.message);
  const row = p.data;
  await db().from("receivable_payments").delete().eq("id", id);
  if (row.transaction_id) await db().from("transactions").delete().eq("id", row.transaction_id);
  await db().from("receivables").update({ status: "active" }).eq("id", row.receivable_id);
  await logActivity("receivable_payment.delete", "receivables", { amount: Number(row.amount) });
}

export async function deleteReceivable(id: string) {
  const r = await db()
    .from("receivables")
    .select("name, amount, currency, transaction_id")
    .eq("id", id)
    .single();
  const pays = await db()
    .from("receivable_payments")
    .select("transaction_id")
    .eq("receivable_id", id);
  const txIds = [r.data?.transaction_id, ...(pays.data ?? []).map((x) => x.transaction_id)].filter(
    (x): x is string => !!x,
  );
  const del = await db().from("receivables").delete().eq("id", id);
  if (del.error) throw new Error(del.error.message);
  if (txIds.length) await db().from("transactions").delete().in("id", txIds);
  await logActivity("receivables.delete", "receivables", {
    name: r.data?.name ?? null,
    amount: r.data?.amount ?? null,
  });
}

/** Outstanding receivable principal (IDR) per lent month, minus repayments per month. */
export async function receivableDeltasByMonth(
  rate: number,
): Promise<{ month: string; delta: number }[]> {
  const [r, p] = await Promise.all([
    fetchAll((from, to) =>
      db()
        .from("receivables")
        .select("id, amount, currency, lent_at, account_id")
        .order("id")
        .range(from, to),
    ),
    fetchAll((from, to) =>
      db()
        .from("receivable_payments")
        .select("receivable_id, amount, paid_at")
        .order("id")
        .range(from, to),
    ),
  ]);
  if (r.error || p.error) return [];
  const cur = new Map((r.data ?? []).map((x) => [x.id, x]));
  const out: { month: string; delta: number }[] = [];
  // Only linked loans left the account balance; unlinked ones never entered net worth.
  for (const x of r.data ?? [])
    if (x.account_id)
      out.push({
        month: String(x.lent_at).slice(0, 7),
        delta: Number(x.amount) * (x.currency === "USD" ? rate : 1),
      });
  for (const y of p.data ?? []) {
    const rec = cur.get(y.receivable_id);
    if (rec?.account_id)
      out.push({
        month: String(y.paid_at).slice(0, 7),
        delta: -Number(y.amount) * (rec.currency === "USD" ? rate : 1),
      });
  }
  return out;
}

/** Dashboard overview: asset composition, gold position, receivables, goals and today's gold prices. */
export async function assetsOverview() {
  const [rate, bal, goals, gold, rec] = await Promise.all([
    getUsdIdr(),
    db().from("account_balances").select("type, currency, balance").eq("archived", false),
    db().from("goals").select("target_amount, saved_amount"),
    goldSummary({ limit: 1 }),
    listReceivables({ limit: 10000 }),
  ]);
  const groups: Record<string, number> = { cash: 0, investment: 0, credit: 0 };
  for (const b of bal.data ?? []) {
    const v = Number(b.balance) * (b.currency === "USD" ? rate : 1);
    if (b.type === "investment") groups["investment"]! += v;
    else if (b.type === "credit_card") groups["credit"]! += v;
    else groups["cash"]! += v;
  }
  const goldInfo = gold.ready
    ? (() => {
        const h = gold.holdings;
        const val = (p: any) =>
          p
            ? {
                value: Math.round(h.grams * p.buyback),
                pnl: Math.round(h.grams * p.buyback) - h.cost,
                buy: p.buy,
                buyback: p.buyback,
                estimated: p.estimated,
                date: p.date,
              }
            : null;
        return {
          ready: true,
          grams: h.grams,
          cost: h.cost,
          avgPrice: h.avgPrice,
          realized: h.realized,
          world: val(gold.prices.world),
          antam: val(gold.prices.antam),
        };
      })()
    : { ready: false as const };
  const receivablesOutstanding = rec.ready
    ? rec.outstandingRows.reduce(
        (a: number, i: any) => a + i.remaining * (i.currency === "USD" ? rate : 1),
        0,
      )
    : 0;
  const g = goals.data ?? [];
  const goalsSaved = g.reduce((a, x) => a + Number(x.saved_amount), 0);
  const goalsTarget = g.reduce((a, x) => a + Number(x.target_amount), 0);
  const goldValue = (goldInfo as any).antam?.value ?? (goldInfo as any).world?.value ?? 0;
  const composition = [
    { key: "cash", value: Math.max(0, groups["cash"]!) },
    { key: "investment", value: Math.max(0, groups["investment"]!) },
    { key: "gold", value: goldValue },
    { key: "receivables", value: receivablesOutstanding },
  ].filter((c) => c.value > 0);
  return {
    gold: goldInfo,
    receivablesOutstanding,
    goalsSaved,
    goalsTarget,
    composition,
    totalAssets: composition.reduce((a, c) => a + c.value, 0),
    creditCardIdr: groups["credit"]!,
  };
}
