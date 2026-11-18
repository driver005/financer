import { useRef, type RefObject } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { scrollTopFor } from "@/lib/paginate";

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;
}

/** Bottom edge of any sticky/fixed header pinned to the top of the viewport (mobile top bar). */
function stickyHeaderOffset(): number {
  let bottom = 0;
  for (const el of Array.from(document.querySelectorAll("header"))) {
    const pos = window.getComputedStyle(el).position;
    if (pos !== "sticky" && pos !== "fixed") continue;
    const r = el.getBoundingClientRect();
    if (r.height > 0 && r.top <= 0 && r.bottom > bottom) bottom = r.bottom;
  }
  return bottom;
}

/** Smoothly bring the top of `el` into view when it has scrolled above the viewport. */
function revealTop(el: Element | null | undefined) {
  if (!el || typeof window === "undefined") return;
  const top = scrollTopFor(el.getBoundingClientRect().top, window.scrollY, stickyHeaderOffset());
  if (top === null) return;
  window.scrollTo({ top, behavior: prefersReducedMotion() ? "auto" : "smooth" });
}

export function Pagination({
  offset,
  pageSize,
  total,
  visible,
  onChange,
  scrollTargetRef,
  scrollOnChange = true,
}: {
  offset: number;
  pageSize: number;
  total: number;
  visible: number;
  onChange: (offset: number) => void;
  /** Element whose top is scrolled into view on page change; defaults to the nav's previous sibling (the list). */
  scrollTargetRef?: RefObject<HTMLElement | null>;
  /** Set false to keep the scroll position when the page changes. */
  scrollOnChange?: boolean;
}) {
  const { t } = useI18n();
  const navRef = useRef<HTMLElement>(null);
  if (total <= pageSize) return null;
  const page = Math.floor(offset / pageSize) + 1;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  function go(next: number) {
    onChange(next);
    if (scrollOnChange)
      revealTop(scrollTargetRef?.current ?? navRef.current?.previousElementSibling);
  }
  return (
    <nav
      ref={navRef}
      className="no-print mt-3 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 text-sm"
      aria-label={t("Navigasi halaman")}
    >
      <p className="min-w-0 truncate text-muted-foreground">
        {offset + 1}–{offset + visible} {t("dari")} {total}
      </p>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          size="icon"
          variant="outline"
          disabled={offset === 0}
          onClick={() => go(Math.max(0, offset - pageSize))}
          aria-label={t("Sebelumnya")}
        >
          <ChevronLeft className="size-4" />
        </Button>
        <span className="min-w-14 text-center">
          {page} / {pages}
        </span>
        <Button
          size="icon"
          variant="outline"
          disabled={offset + visible >= total}
          onClick={() => go(offset + pageSize)}
          aria-label={t("Berikutnya")}
        >
          <ChevronRight className="size-4" />
        </Button>
      </div>
    </nav>
  );
}
