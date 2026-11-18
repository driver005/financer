import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState } from "react";
import { PageHeader } from "@/components/app-shell";
import { Pagination } from "@/components/pagination";
import { SortButton, type SortDirection } from "@/components/sort-button";
import { RouteError } from "@/components/route-error";
import { PageSkeleton, PENDING_MS } from "@/components/skeletons";
import { Empty, RowActions, useCrudDialog } from "@/components/crud-page";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { goldQuery, rowsQuery } from "@/lib/queries";
import { goldValue, type GoldPrice } from "@/lib/assets";
import { dateLabel, todayStr } from "@/lib/dates";
import { money } from "@/lib/format";
import { secret, usePrivacy } from "@/lib/privacy";
import { useI18n } from "@/lib/i18n";
import { pageHead } from "@/lib/head";
import { WalletFilter } from "@/components/wallet-filter";
import { resolveReportAccount, validateReportSearch } from "@/lib/report-filter";

/* eslint-disable @typescript-eslint/no-explicit-any */
export const Route = createFileRoute("/_app/gold")({
  head: () =>
    pageHead(
      "Tabungan Emas",
      "Catat pembelian dan penjualan emas, pantau nilai dengan harga dunia dan Antam.",
    ),
  validateSearch: validateReportSearch,
  loaderDeps: ({ search }) => ({ account: search.account }),
  loader: ({ context, deps }) =>
    context.queryClient.ensureQueryData(goldQuery(deps.account ? { account: deps.account } : {})),
  errorComponent: RouteError,
  pendingComponent: PageSkeleton,
  pendingMs: PENDING_MS,
  component: GoldPage,
});

function GoldPage() {
  usePrivacy();
  const { t, lang } = useI18n();
  const locale = lang === "en" ? "en-US" : "id-ID";
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const [offset, setOffset] = useState(0);
  const [sort, setSort] = useState<"occurred_at" | "grams" | "price_per_gram" | "total">(
    "occurred_at",
  );
  const [direction, setDirection] = useState<SortDirection>("desc");
  const pageSize = 25;
  const accounts = (useQuery(rowsQuery("accounts")).data ?? []) as {
    id: string;
    name: string;
    archived?: boolean;
  }[];
  const account = resolveReportAccount(search.account, accounts);
  const setAccount = (a: string | undefined) => {
    setOffset(0);
    void navigate({ search: a ? { account: a } : {}, replace: true });
  };
  const { data, isFetching } = useQuery({
    ...goldQuery({ offset, limit: pageSize, sort, direction, ...(account ? { account } : {}) }),
    placeholderData: (p) => p,
  });
  const accName = (id: string | null | undefined) => accounts.find((a) => a.id === id)?.name;
  const crud = useCrudDialog("gold_purchases", {
    kind: "buy",
    occurred_at: todayStr(),
    place: "Antam",
  });

  const edit = (r: any) =>
    crud.openEdit({
      id: r.id,
      kind: r.kind,
      occurred_at: r.occurred_at,
      grams: r.grams,
      price_per_gram: r.price_per_gram,
      total: r.total,
      place: r.place,
      gold_type: r.gold_type,
      product_number: r.product_number,
      account_id: r.account_id ?? "",
      notes: r.notes,
    });

  function sortBy(column: typeof sort) {
    setDirection((current) =>
      sort === column
        ? current === "asc"
          ? "desc"
          : "asc"
        : column === "occurred_at"
          ? "desc"
          : "asc",
    );
    setSort(column);
    setOffset(0);
  }

  if (!data) return null;
  if (!data.ready) {
    return (
      <>
        <PageHeader title={t("Tabungan Emas")} />
        <Empty
          text={t(
            "Tabel emas belum ada. Jalankan bagian v3 di supabase/schema.sql lewat SQL Editor Supabase.",
          )}
        />
      </>
    );
  }
  const { rows, holdings, prices, total } = data as {
    rows: any[];
    total: number;
    holdings: { grams: number; cost: number; avgPrice: number; realized: number };
    prices: { world: GoldPrice | null; antam: GoldPrice | null };
  };

  return (
    <>
      <PageHeader
        title={t("Tabungan Emas")}
        subtitle={`${t("Nilai dihitung dari harga buyback per gram.")} ${t("Pilih akun agar beli/jual emas otomatis tercatat di Transaksi.")}`}
        actions={
          <Button onClick={() => crud.openNew()}>
            <Plus className="size-4" /> {t("Catat")}
          </Button>
        }
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label={t("Total emas")}
          value={`${secret(holdings.grams.toLocaleString(locale))} g`}
        />
        <Stat label={t("Modal")} value={money(holdings.cost)} />
        <Stat label={t("Rata-rata harga beli")} value={`${money(holdings.avgPrice)}/g`} />
        <Stat
          label={t("Untung terealisasi")}
          value={money(holdings.realized)}
          tone={holdings.realized >= 0 ? "text-income" : "text-expense"}
        />
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {([prices.world, prices.antam] as const).map((p, i) => {
          const title = i === 0 ? t("Harga dunia (XAU)") : t("Antam / Pegadaian");
          const v = goldValue(holdings.grams, p, holdings.cost);
          return (
            <Card key={i} className="min-w-0 p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-semibold">{title}</h2>
                {p ? (
                  <Badge variant={p.estimated ? "outline" : "secondary"}>
                    {p.estimated ? t("perkiraan") : dateLabel(p.date, locale)}
                  </Badge>
                ) : null}
              </div>
              {p && v ? (
                <>
                  <div className="mt-3 grid grid-cols-1 gap-2 text-sm min-[400px]:grid-cols-2">
                    <div className="min-w-0">
                      <p className="text-xs text-muted-foreground">{t("Harga jual")}</p>
                      <p className="num break-words font-semibold">{money(p.buy)}/g</p>
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs text-muted-foreground">{t("Buyback")}</p>
                      <p className="num break-words font-semibold">{money(p.buyback)}/g</p>
                    </div>
                  </div>
                  <p className="mt-4 text-xs text-muted-foreground">{t("Nilai sekarang")}</p>
                  <p className="num break-words font-display text-2xl font-bold">
                    {money(v.value)}
                  </p>
                  <p
                    className={`num break-words text-sm font-semibold ${v.pnl >= 0 ? "text-income" : "text-expense"}`}
                  >
                    {v.pnl >= 0 ? "+" : "−"}
                    {money(Math.abs(v.pnl))} ({v.pnlPct.toFixed(1)}%)
                  </p>
                </>
              ) : (
                <p className="mt-3 text-sm text-muted-foreground">
                  {t("Harga belum tersedia, coba lagi nanti.")}
                </p>
              )}
            </Card>
          );
        })}
      </div>
      <div
        className="no-print mt-4 flex max-w-full flex-wrap items-center gap-1"
        aria-label={t("Urutkan")}
      >
        <SortButton
          label={t("Tanggal transaksi")}
          active={sort === "occurred_at"}
          direction={direction}
          onClick={() => sortBy("occurred_at")}
        />
        <SortButton
          label={t("Gram")}
          active={sort === "grams"}
          direction={direction}
          onClick={() => sortBy("grams")}
        />
        <SortButton
          label={t("Harga per gram")}
          active={sort === "price_per_gram"}
          direction={direction}
          onClick={() => sortBy("price_per_gram")}
        />
        <SortButton
          label={t("Total")}
          active={sort === "total"}
          direction={direction}
          onClick={() => sortBy("total")}
        />
        <WalletFilter value={account} accounts={accounts} onChange={setAccount} />
        {isFetching ? (
          <span className="ml-auto text-xs text-muted-foreground">{t("Memuat…")}</span>
        ) : null}
      </div>
      <Card className="mt-2 min-w-0 overflow-hidden">
        {rows.length === 0 ? (
          <p className="p-10 text-center text-sm text-muted-foreground">
            {t("Belum ada catatan emas.")}
          </p>
        ) : (
          <>
            <ul className="divide-y md:hidden">
              {rows.map((r) => (
                <li
                  key={r.id}
                  className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 px-4 py-3"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <Badge
                      variant={r.kind === "buy" ? "secondary" : "outline"}
                      className="shrink-0"
                    >
                      {r.kind === "buy" ? t("Beli") : t("Jual")}
                    </Badge>
                    <p className="num min-w-0 truncate text-sm font-medium">
                      {secret(String(r.grams))} g
                    </p>
                  </div>
                  <p className="num min-w-0 break-words text-right text-sm font-semibold">
                    {money(r.total)}
                  </p>
                  <div className="col-span-2 min-w-0 text-xs text-muted-foreground">
                    {r.gold_type || r.place ? (
                      <p className="truncate">
                        {[r.gold_type, r.place].filter(Boolean).join(" · ")}
                      </p>
                    ) : null}
                    <p className="truncate">
                      <span className="num">{money(r.price_per_gram)}/g</span>
                      {r.product_number ? ` · ${r.product_number}` : ""}
                    </p>
                  </div>
                  <div className="col-span-2 flex min-w-0 items-center justify-between gap-2 border-t pt-1">
                    <p className="min-w-0 truncate text-xs text-muted-foreground">
                      {dateLabel(r.occurred_at, locale)}
                      {accName(r.account_id) ? ` · ${accName(r.account_id)}` : ""}
                    </p>
                    <RowActions
                      onEdit={() => edit(r)}
                      onDelete={() => crud.remove(r.id, `${secret(String(r.grams))} g`)}
                    />
                  </div>
                </li>
              ))}
            </ul>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 font-medium">{t("Tanggal transaksi")}</th>
                    <th className="px-4 py-2 font-medium">{t("Jenis")}</th>
                    <th className="px-4 py-2 font-medium">{t("Detail")}</th>
                    <th className="px-4 py-2 text-right font-medium">{t("Gram")}</th>
                    <th className="px-4 py-2 text-right font-medium">{t("Harga per gram")}</th>
                    <th className="px-4 py-2 text-right font-medium">{t("Total")}</th>
                    <th className="px-2 py-2">
                      <span className="sr-only">{t("Aksi")}</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rows.map((r) => (
                    <tr key={r.id} className="align-middle">
                      <td className="whitespace-nowrap px-4 py-2.5">
                        {dateLabel(r.occurred_at, locale)}
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge variant={r.kind === "buy" ? "secondary" : "outline"}>
                          {r.kind === "buy" ? t("Beli") : t("Jual")}
                        </Badge>
                      </td>
                      <td className="max-w-[16rem] px-4 py-2.5">
                        <p className="truncate">
                          {[r.gold_type, r.place].filter(Boolean).join(" · ") || "—"}
                        </p>
                        {r.product_number || accName(r.account_id) ? (
                          <p className="truncate text-xs text-muted-foreground">
                            {[r.product_number, accName(r.account_id)].filter(Boolean).join(" · ")}
                          </p>
                        ) : null}
                      </td>
                      <td className="num whitespace-nowrap px-4 py-2.5 text-right">
                        {secret(String(r.grams))} g
                      </td>
                      <td className="num whitespace-nowrap px-4 py-2.5 text-right">
                        {money(r.price_per_gram)}
                      </td>
                      <td className="num whitespace-nowrap px-4 py-2.5 text-right font-semibold">
                        {money(r.total)}
                      </td>
                      <td className="px-2 py-1.5">
                        <div className="flex justify-end">
                          <RowActions
                            onEdit={() => edit(r)}
                            onDelete={() => crud.remove(r.id, `${secret(String(r.grams))} g`)}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>
      <Pagination
        offset={offset}
        pageSize={pageSize}
        total={total}
        visible={rows.length}
        onChange={setOffset}
      />
      {crud.dialog(t("emas"), [
        {
          name: "kind",
          label: t("Jenis"),
          type: "select",
          half: true,
          options: [
            { value: "buy", label: t("Beli") },
            { value: "sell", label: t("Jual") },
          ],
        },
        { name: "occurred_at", label: t("Tanggal"), type: "date", half: true },
        { name: "grams", label: t("Gram"), type: "number", half: true, step: "0.0001" },
        { name: "price_per_gram", label: t("Harga per gram"), type: "number", half: true },
        { name: "total", label: t("Total (kosongkan = otomatis)"), type: "number", half: true },
        {
          name: "place",
          label: t("Tempat"),
          type: "text",
          half: true,
          placeholder: "Antam, Pegadaian, Tokopedia…",
        },
        {
          name: "gold_type",
          label: t("Tipe emas (opsional)"),
          type: "text",
          half: true,
          placeholder: "Antam CertiCard, UBS…",
        },
        {
          name: "product_number",
          label: t("Nomor produk / nomor emas (opsional)"),
          type: "text",
          half: true,
        },
        {
          name: "account_id",
          label: t("Akun pembayaran (opsional)"),
          type: "select",
          options: [
            { value: "", label: t("— Tanpa transaksi —") },
            ...accounts.filter((a) => !a.archived).map((a) => ({ value: a.id, label: a.name })),
          ],
        },
        { name: "notes", label: t("Catatan"), type: "textarea" },
      ])}
    </>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <Card className="min-w-0 p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`num break-words text-base font-semibold sm:text-lg ${tone ?? ""}`}>{value}</p>
    </Card>
  );
}
