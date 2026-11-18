import { ArrowUp } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useScrolledPast } from "@/hooks/use-scrolled-past";

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;
}

/**
 * Floating "back to top" button, shown once the visitor has scrolled about one viewport.
 * `focusId` names a focusable (tabIndex -1) element at the start of the page that receives
 * focus afterwards, so keyboard and screen-reader users land at the top too.
 */
export function BackToTop({ focusId, className }: { focusId?: string; className?: string }) {
  const { t } = useI18n();
  const visible = useScrolledPast(() => window.innerHeight * 0.9);
  function toTop() {
    window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? "auto" : "smooth" });
    if (focusId) document.getElementById(focusId)?.focus({ preventScroll: true });
  }
  return (
    <button
      type="button"
      onClick={toTop}
      aria-label={t("Kembali ke atas")}
      title={t("Kembali ke atas")}
      className={cn(
        "fixed right-[max(1rem,env(safe-area-inset-right))] bottom-[max(1rem,env(safe-area-inset-bottom))] z-30 flex size-11 items-center justify-center rounded-full border bg-card/90 text-foreground shadow-md backdrop-blur transition-[opacity,visibility,background-color] duration-200 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:right-[max(1.5rem,env(safe-area-inset-right))] sm:bottom-[max(1.5rem,env(safe-area-inset-bottom))]",
        // `invisible` removes it from the tab order and accessibility tree while hidden.
        visible ? "visible opacity-100" : "invisible opacity-0",
        className,
      )}
    >
      <ArrowUp className="size-5" aria-hidden="true" />
    </button>
  );
}
