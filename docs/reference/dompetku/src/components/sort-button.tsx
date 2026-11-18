import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";

export type SortDirection = "asc" | "desc";

export function SortButton({
  label,
  active,
  direction,
  onClick,
}: {
  label: string;
  active: boolean;
  direction: SortDirection;
  onClick: () => void;
}) {
  const { t } = useI18n();
  const Icon = active ? (direction === "asc" ? ArrowUp : ArrowDown) : ChevronsUpDown;
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-8 gap-1 px-1 font-semibold"
      onClick={onClick}
      aria-label={`${t("Urutkan")} ${label} ${active ? (direction === "asc" ? t("menurun") : t("menaik")) : t("menaik")}`}
      aria-pressed={active}
    >
      {label}
      <Icon className="size-3.5" aria-hidden="true" />
    </Button>
  );
}
