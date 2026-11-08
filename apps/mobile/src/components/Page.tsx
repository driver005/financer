import { usePathname, useRouter } from "expo-router";
import type { ReactNode } from "react";
import { IconButton, Screen, TopBar } from "@financer/ui";

import { useGlobalSearch } from "@/components/GlobalSearch";
import { areaFor } from "@/navigation";

/**
 * One finance page: a title bar and the content under it. On the everyday screens a Settings button
 * ends the bar; in the settings area a back button starts it. `actions` are the screen's own tools
 * (icon buttons), shown before the Settings button.
 */
export function Page({
  title,
  subtitle,
  actions,
  footer,
  fixed,
  back: withBack,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  footer?: ReactNode;
  /** The content scrolls by itself (a long list); the page does not. */
  fixed?: boolean;
  /** Start the bar with a back button (a page opened from a list, like one recipe). */
  back?: boolean;
  children: ReactNode;
}) {
  const router = useRouter();
  const search = useGlobalSearch();
  const area = areaFor(usePathname());
  const back = () => (router.canGoBack() ? router.back() : router.replace("/"));
  return (
    <Screen
      fixed={fixed}
      footer={footer}
      header={
        <TopBar
          title={title}
          subtitle={subtitle}
          onBack={area === "settings" || withBack ? back : undefined}
          actions={
            <>
              {actions}
              <IconButton icon="magnify" label="Search the whole app" onPress={search.open} />
              {area === "tab" ? <IconButton icon="cog-outline" label="Settings" onPress={() => router.push("/settings")} /> : null}
            </>
          }
        />
      }
    >
      {children}
    </Screen>
  );
}
