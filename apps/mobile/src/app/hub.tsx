import React from "react";
import { useRouter } from "expo-router";
import { Box, Card, Icon, Text, type IconName } from "@finance/ui";
import { Screen, SectionTitle } from "../ui/primitives";

const GROUPS: { title: string; items: { label: string; route: string; icon: IconName }[] }[] = [
  { title: "Overview", items: [
    { label: "Home", route: "/home", icon: "home" },
    { label: "Connect accounts", route: "/connect", icon: "link" },
    { label: "Automatically categorised", route: "/categorised", icon: "tag-check-outline" },
    { label: "Transactions", route: "/transactions", icon: "receipt" },
    { label: "Accounts", route: "/accounts", icon: "wallet" },
    { label: "Reports", route: "/reports", icon: "chart-bar" },
    { label: "Insights", route: "/insights", icon: "chart-line" },
    { label: "Insurance", route: "/insurance", icon: "shield-outline" },
    { label: "Savings Booster", route: "/savings", icon: "piggy-bank" },
  ] },
  { title: "Planning", items: [
    { label: "Goals & budgets", route: "/goals", icon: "target" },
    { label: "Projects", route: "/projects", icon: "folder" },
    { label: "Paycheck", route: "/paycheck", icon: "cash" },
    { label: "Obligations", route: "/obligations", icon: "calendar-clock" },
    { label: "Contracts", route: "/contracts", icon: "file-document-outline" },
    { label: "Assets", route: "/holdings", icon: "gold" },
  ] },
  { title: "Everyday", items: [
    { label: "Price comparison", route: "/prices", icon: "tag-search" },
    { label: "Recipes", route: "/recipes", icon: "food" },
    { label: "Shopping list", route: "/list", icon: "cart" },
    { label: "Shops & offers", route: "/shops", icon: "store" },
    { label: "Best prices", route: "/optimize", icon: "tag" },
  ] },
  { title: "Tools", items: [
    { label: "Finance suite", route: "/finance", icon: "view-dashboard" },
    { label: "Upstream", route: "/upstream", icon: "apps" },
    { label: "Parity gaps", route: "/gaps", icon: "tune" },
    { label: "Money flows", route: "/flows", icon: "swap-horizontal" },
    { label: "Ask money", route: "/ask", icon: "comment-question" },
    { label: "PC editor", route: "/pc", icon: "laptop" },
    { label: "UI kit", route: "/showcase", icon: "palette" },
    { label: "Settings", route: "/settings", icon: "cog" },
  ] },
];

export default function HubScreen() {
  const router = useRouter();
  return (
    <Screen title="All apps" subtitle="One app, every merged screen">
      {GROUPS.map((group) => (
        <Box key={group.title} gap={8}>
          <SectionTitle>{group.title}</SectionTitle>
          <Box row gap={8} style={{ flexWrap: "wrap" }}>
            {group.items.map((item) => (
              <Card key={item.route} onPress={() => router.push(item.route as never)} style={{ width: "47%", minHeight: 86, alignItems: "flex-start", justifyContent: "space-between" }}>
                <Icon name={item.icon} size={22} />
                <Text variant="body4">{item.label}</Text>
              </Card>
            ))}
          </Box>
        </Box>
      ))}
    </Screen>
  );
}
