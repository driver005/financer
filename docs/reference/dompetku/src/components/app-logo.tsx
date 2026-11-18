import { queryOptions, useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { DEFAULT_BRANDING, DEFAULT_TAGLINE, type Branding } from "@/lib/app-settings";
import { getPublicBranding } from "@/lib/app-settings.functions";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/** Public branding (name, tagline, logo) — safe without login; defaults while loading. */
export const brandingQuery = () =>
  queryOptions({
    queryKey: ["branding"],
    queryFn: () => getPublicBranding(),
    staleTime: 300_000,
  });

export function useBranding(): Branding {
  return useQuery(brandingQuery()).data ?? DEFAULT_BRANDING;
}

/** Tagline through t() while it is still the built-in default. */
export function useTagline(): string {
  const { t } = useI18n();
  const b = useBranding();
  return b.tagline === DEFAULT_TAGLINE ? t(DEFAULT_TAGLINE) : b.tagline;
}

/** The app mark: custom logo from Settings, else the bundled wallet logo. */
export function AppLogo({ className }: { className?: string }) {
  const b = useBranding();
  return (
    <img
      src={b.has_logo ? b.logo_url : "/logo.svg"}
      alt=""
      aria-hidden="true"
      width={32}
      height={32}
      className={cn("size-8 shrink-0 rounded-[22%] object-contain", className)}
    />
  );
}

/** "Name." wordmark with the accent dot. */
export function AppName({ className }: { className?: string }) {
  const b = useBranding();
  return (
    <span className={className}>
      {b.app_name}
      <span className="text-sidebar-primary">.</span>
    </span>
  );
}

/**
 * Keeps the favicon and document title in sync with Settings (client-side; the static
 * manifest stays as is so previews and installs keep working without the v14 table).
 */
export function BrandingSync() {
  const b = useBranding();
  useEffect(() => {
    if (!b.has_logo) return;
    const links = document.querySelectorAll<HTMLLinkElement>('link[rel="icon"]');
    links.forEach((l) => {
      l.dataset["orig"] ??= l.href;
      l.href = b.logo_url;
      l.removeAttribute("type");
    });
    return () => links.forEach((l) => (l.href = l.dataset["orig"] ?? l.href));
  }, [b.has_logo, b.logo_url]);
  useEffect(() => {
    if (b.app_name === DEFAULT_BRANDING.app_name) return;
    const fix = () => {
      const d = document.title;
      // Skip when already renamed (also stops loops when the new name contains the old one).
      if (d.includes(DEFAULT_BRANDING.app_name) && !d.includes(b.app_name))
        document.title = document.title.replaceAll(DEFAULT_BRANDING.app_name, b.app_name);
    };
    fix();
    const title = document.querySelector("title");
    if (!title) return;
    const obs = new MutationObserver(fix);
    obs.observe(title, { childList: true, characterData: true, subtree: true });
    return () => obs.disconnect();
  }, [b.app_name]);
  return null;
}
