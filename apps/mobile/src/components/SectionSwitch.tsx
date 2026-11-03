import { usePathname, useRouter } from "expo-router";
import { Segmented } from "@financer/ui";

import { tap } from "@/native/haptics";
import { switchFor } from "@/navigation";

/**
 * The switcher under the title of screens that share a tab (Spending | Budget, Prices | Recipes |
 * Meal plan | Usual items). Renders nothing on other screens, so it can be dropped in anywhere.
 */
export function SectionSwitch() {
  const router = useRouter();
  const current = switchFor(usePathname());
  if (!current) return null;
  return (
    <Segmented
      options={current.items.map((i) => ({ value: i.href, label: i.label }))}
      value={current.active}
      onChange={(href) => {
        tap();
        if (href !== current.active) router.replace(href as never);
      }}
    />
  );
}
