import { AlertTriangle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { CHART_PALETTE as PIE } from "@/components/charts/shared";
import { money } from "@/lib/format";
import { usePrivacy } from "@/lib/privacy";
import { useI18n } from "@/lib/i18n";
import { formatPercent, incomeRatios, type RatioCategory, type RatioSlice } from "@/lib/ratio";

/** Neutral fill for the "Lainnya" bucket so it never competes with a category hue. */
const OTHER_COLOR = "color-mix(in oklab, var(--muted-foreground) 45%, transparent)";

function sliceColor(s: RatioSlice): string {
  if (s.kind === "leftover") return "var(--income)";
  if (s.kind === "other") return OTHER_COLOR;
  // Same colour rule as the "Pengeluaran per kategori" donut (index in byCategory).
  return s.color ?? PIE[s.index % PIE.length]!;
}

/**
 * "Rasio terhadap pemasukan": one 100% stacked bar showing how this month's income was
 * split across the top expense categories, other spending and what is left over.
 */
export function IncomeRatioCard({
  income,
  expense,
  categories,
  className = "",
}: {
  income: number;
  expense: number;
  categories: readonly RatioCategory[];
  className?: string;
}) {
  usePrivacy();
  const { t } = useI18n();
  const r = incomeRatios({ income, expense, categories, top: 5 });
  const label = (s: RatioSlice) => (s.kind === "category" ? s.name : t(s.name));
  const hint = t(
    "Sisa = pemasukan − pengeluaran. Setoran ke target tabungan dicatat sebagai transfer, jadi tetap terhitung di sini.",
  );

  const summary = r.empty
    ? t("Belum ada pemasukan bulan ini.")
    : `${t("Rasio terhadap pemasukan")}: ` +
      r.slices.map((s) => `${label(s)} ${formatPercent(s.percent)}`).join(", ") +
      (r.deficit > 0 ? `. ${t("Pengeluaran melebihi pemasukan")} ${money(r.deficit)}` : "");

  return (
    <Card className={`min-w-0 p-5 ${className}`}>
      <div className="mb-4 flex min-w-0 flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">{t("Rasio terhadap pemasukan")}</h2>
          <p className="text-xs text-muted-foreground">{hint}</p>
        </div>
        {!r.empty ? (
          <p className="shrink-0 text-sm text-muted-foreground">
            {t("Terpakai")}{" "}
            <span
              className={`num font-semibold ${r.deficit > 0 ? "text-expense" : "text-foreground"}`}
            >
              {formatPercent(r.spentPercent)}
            </span>
          </p>
        ) : null}
      </div>

      {r.empty ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {t("Belum ada pemasukan bulan ini.")}
        </p>
      ) : (
        <>
          <div className="relative">
            <div
              role="img"
              aria-label={summary}
              className="flex h-4 w-full gap-0.5 overflow-hidden rounded-full"
            >
              {r.slices.map((s) => (
                <div
                  key={s.key}
                  className="h-full min-w-1 first:rounded-l-full last:rounded-r-full transition-[flex-grow]"
                  style={{ flexGrow: s.width, flexBasis: 0, background: sliceColor(s) }}
                  title={`${label(s)} · ${formatPercent(s.percent)} · ${money(s.value)}`}
                />
              ))}
            </div>
            {r.deficit > 0 ? (
              // Where income ends: everything to the right of this line is overspend.
              <span
                aria-hidden="true"
                className="absolute -top-1 -bottom-1 w-0.5 rounded-full bg-foreground"
                style={{ left: `calc(${r.incomeMark}% - 1px)` }}
              />
            ) : null}
          </div>

          {r.deficit > 0 ? (
            <p className="mt-3 flex items-start gap-1.5 text-xs text-expense">
              <AlertTriangle className="mt-px size-3.5 shrink-0" />
              <span>
                {t("Pengeluaran melebihi pemasukan")}{" "}
                <span className="num font-medium">{money(r.deficit)}</span> (
                {formatPercent(r.spentPercent - 100)}). {t("Garis menandai batas pemasukan.")}
              </span>
            </p>
          ) : null}

          <ul className="mt-4 grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
            {r.slices.map((s) => (
              <li key={s.key} className="flex min-w-0 items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ background: sliceColor(s) }}
                  />
                  <span className="truncate">{label(s)}</span>
                </span>
                <span className="flex shrink-0 items-baseline gap-2">
                  <span className="num text-xs text-muted-foreground">{money(s.value)}</span>
                  <span className="num w-11 text-right font-semibold">
                    {formatPercent(s.percent)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}
