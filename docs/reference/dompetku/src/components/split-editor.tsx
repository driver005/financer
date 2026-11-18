import { Plus, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { money } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { guessCategory } from "@/lib/bot";
import {
  balanceLastRow,
  rowsFromItems,
  splitRemaining,
  SPLIT_MAX_ROWS,
  type ReceiptItem,
  type SplitRow,
} from "@/lib/split";
import type { Category } from "@/lib/schemas";

/** Form keys used by TransactionDialog to carry split state (stripped before saving). */
export const SPLIT_ON = "__split_on";
export const SPLIT_ROWS = "__split_rows";

const NONE = "__none";
const empty = (): SplitRow => ({ category_id: null, amount: "", note: "" });

/** Toggle + rows editor for "split one receipt over several expense categories". */
export function SplitEditor({
  values,
  set,
  categories,
}: {
  values: Record<string, unknown>;
  set: (k: string, v: unknown) => void;
  categories: Category[];
}) {
  const { t } = useI18n();
  const on = !!values[SPLIT_ON];
  const rows = (values[SPLIT_ROWS] as SplitRow[] | undefined) ?? [];
  const currency = String(values["currency"] ?? "IDR");
  const total = values["amount"] as number | string;
  const remaining = splitRemaining(total, rows);
  const expense = categories.filter((c) => c.kind === "expense");
  const items = (values["items"] as ReceiptItem[] | null) ?? [];

  const setRows = (r: SplitRow[]) => set(SPLIT_ROWS, r);
  const update = (i: number, patch: Partial<SplitRow>) =>
    setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  function fromItems() {
    const names = expense.map((c) => c.name);
    const guess = (name: string) => {
      const n = guessCategory(name, names);
      return expense.find((c) => c.name === n)?.id ?? null;
    };
    const fallback = (values["category_id"] as string | null) ?? null;
    const built = rowsFromItems(items, (n) => guess(n) ?? fallback);
    if (built.length) setRows(Number(total) > 0 ? balanceLastRow(total, built) : built);
  }

  function toggle(c: boolean) {
    set(SPLIT_ON, c);
    if (c && rows.length < 2) {
      const first: SplitRow = {
        category_id: (values["category_id"] as string | null) ?? null,
        amount: Number(total) > 0 ? Number(total) : "",
        note: "",
      };
      setRows([first, empty()]);
    }
  }

  return (
    <div className="rounded-lg border bg-muted/50 p-3 text-sm">
      <label className="flex items-center justify-between gap-2">
        <span className="font-medium">{t("Bagi ke beberapa kategori")}</span>
        <Switch checked={on} onCheckedChange={toggle} />
      </label>
      {on ? (
        <div className="mt-3 space-y-2">
          {rows.map((r, i) => (
            <div
              key={i}
              className="grid grid-cols-1 gap-2 rounded-md border bg-background p-2 sm:grid-cols-[minmax(0,1fr)_7.5rem_auto]"
            >
              <Select
                value={r.category_id ?? NONE}
                onValueChange={(x) => update(i, { category_id: x === NONE ? null : x })}
              >
                <SelectTrigger className="min-w-0" aria-label={t("Kategori")}>
                  <SelectValue placeholder={t("Pilih kategori")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{t("Pilih kategori")}</SelectItem>
                  {expense.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                className="num min-w-0"
                type="number"
                inputMode="decimal"
                step="any"
                aria-label={t("Jumlah")}
                placeholder="25000"
                value={r.amount}
                onChange={(e) => update(i, { amount: e.target.value })}
              />
              <div className="flex min-w-0 items-center gap-1 sm:row-span-1">
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label={t("Hapus baris")}
                  disabled={rows.length <= 2}
                  onClick={() => setRows(rows.filter((_, j) => j !== i))}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
              <Input
                className="min-w-0 sm:col-span-3"
                aria-label={t("Catatan")}
                placeholder={t("Catatan baris (opsional)")}
                value={r.note ?? ""}
                onChange={(e) => update(i, { note: e.target.value })}
              />
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={rows.length >= SPLIT_MAX_ROWS}
              onClick={() => setRows([...rows, empty()])}
            >
              <Plus className="size-4" /> {t("Tambah baris")}
            </Button>
            {items.some((it) => Number(it.price) > 0) ? (
              <Button type="button" size="sm" variant="outline" onClick={fromItems}>
                <Sparkles className="size-4" /> {t("Isi dari item nota")}
              </Button>
            ) : null}
            {remaining !== 0 && rows.length ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setRows(balanceLastRow(total, rows))}
              >
                {t("Sisakan ke baris terakhir")}
              </Button>
            ) : null}
          </div>
          <p
            className={`num text-xs ${remaining === 0 ? "text-muted-foreground" : "text-expense"}`}
          >
            {t("Sisa")}: {money(remaining, currency, { reveal: true })}
            {remaining === 0 ? ` · ${t("Pas dengan total")}` : ""}
          </p>
          <p className="text-xs text-muted-foreground">
            {t(
              "Setiap baris disimpan sebagai transaksi terpisah. Mengubah satu baris nanti hanya mengubah baris itu.",
            )}
          </p>
        </div>
      ) : null}
    </div>
  );
}
