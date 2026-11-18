import type { ReactNode } from "react";
import { useBranding } from "@/components/app-logo";
import { useI18n } from "@/lib/i18n";
import { repoUrl } from "@/lib/landing";
import { BackToTop } from "@/components/back-to-top";
import { LandingHeader } from "./landing-header";
import { LandingFooter } from "./landing-sections";

/**
 * Chrome shared by the public pages (landing, privacy, terms): skip link, sticky header,
 * footer and back-to-top. Smooth anchor scrolling comes from the app-wide `scroll-behavior`
 * in styles.css (off under reduced motion).
 */
export function LandingShell({
  authenticated,
  onLanding,
  children,
}: {
  authenticated: boolean;
  onLanding: boolean;
  children: (repo: string) => ReactNode;
}) {
  const { t } = useI18n();
  const b = useBranding();
  const repo = repoUrl(b.github_url);
  return (
    <div className="landing min-h-screen bg-background text-foreground">
      <span id="landing-top" tabIndex={-1} className="sr-only" />
      <a
        href="#konten"
        className="sr-only z-50 rounded-md bg-primary px-4 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        {t("Lewati ke konten")}
      </a>
      <LandingHeader authenticated={authenticated} repo={repo} onLanding={onLanding} />
      <main id="konten" tabIndex={-1} className="focus:outline-none">
        {children(repo)}
      </main>
      <LandingFooter repo={repo} onLanding={onLanding} />
      <BackToTop focusId="landing-top" />
    </div>
  );
}
