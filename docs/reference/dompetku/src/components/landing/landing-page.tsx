import { useBranding } from "@/components/app-logo";
import { LandingShell } from "./landing-shell";
import {
  Faq,
  FeatureBento,
  FinalCta,
  Hero,
  HowItWorks,
  SelfHost,
  TechStack,
} from "./landing-sections";

/** Public landing page at `/`: only public branding, never finance data. */
export function LandingPage({ authenticated }: { authenticated: boolean }) {
  const b = useBranding();
  return (
    <LandingShell authenticated={authenticated} onLanding>
      {(repo) => (
        <>
          <Hero tagline={b.landing_tagline} repo={repo} authenticated={authenticated} />
          <FeatureBento />
          <HowItWorks />
          <SelfHost repo={repo} />
          <TechStack />
          <Faq />
          <FinalCta repo={repo} authenticated={authenticated} />
        </>
      )}
    </LandingShell>
  );
}
