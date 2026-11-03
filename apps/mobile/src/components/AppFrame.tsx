import { usePathname, useRouter } from "expo-router";
import type { ReactNode } from "react";
import { AppShell, Button, type NavItem } from "@financer/ui";

import { tap } from "@/native/haptics";
import { TABS, areaFor, tabFor, type TabId } from "@/navigation";

const ITEMS: NavItem<TabId>[] = TABS.map((t) => ({ key: t.id, label: t.title, icon: t.icon as NavItem["icon"] }));

/**
 * The frame of the everyday screens: a bottom bar on a phone, a rail on a tablet and a sidebar on a
 * laptop or the web (one component, `AppShell`). A tab stays selected on every screen that belongs to
 * it (Budget lights up Money). The settings area and the bare screens (setup, shopping assistant) have
 * no navigation at all, as before.
 */
export function AppFrame({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  if (areaFor(pathname) !== "tab") return <>{children}</>;
  const active = tabFor(pathname) ?? "today";
  return (
    <AppShell
      items={ITEMS}
      active={active}
      title="Financer"
      onChange={(id) => {
        tap();
        const tab = TABS.find((t) => t.id === id);
        if (tab && id !== active) router.navigate(tab.href as never);
      }}
      sidebarFooter={<Button label="Settings" icon="cog-outline" variant="ghost" onPress={() => router.push("/settings")} />}
    >
      {children}
    </AppShell>
  );
}
