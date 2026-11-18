import React from "react";
import { useRouter } from "expo-router";
import { Box, Button, Card, Text } from "@finance/ui";
import { Screen, SectionTitle } from "../ui/primitives";

const GROUPS: { title: string; items: { label: string; route: string; icon?: string }[] }[] = [
  { title: "Overview", items: [
    { label: "Home dashboard", route: "/home", icon: "home" },
    { label: "Transactions", route: "/transactions", icon: "receipt" },
    { label: "Accounts & wallets", route: "/accounts", icon: "wallet" },
    { label: "Reports", route: "/reports", icon: "chart-bar" },
  ] },
  { title: "Planning", items: [
    { label: "Goals & budgets", route: "/goals", icon: "target" },
    { label: "Projects & envelopes", route: "/projects", icon: "folder" },
    { label: "Paycheck", route: "/paycheck", icon: "cash" },
    { label: "Obligations", route: "/obligations", icon: "calendar-clock" },
    { label: "Assets & invoices", route: "/assets", icon: "gold" },
  ] },
  { title: "Everyday", items: [
    { label: "Recipes", route: "/recipes", icon: "food" },
    { label: "Shopping list", route: "/list", icon: "cart" },
    { label: "Shops & Angebote", route: "/shops", icon: "store" },
    { label: "Best prices", route: "/optimize", icon: "tag" },
    { label: "Item prices", route: "/item?id=1", icon: "chart-line" },
  ] },
  { title: "Tools", items: [
    { label: "Finance suite", route: "/finance", icon: "view-dashboard" },
    { label: "Upstream features", route: "/upstream", icon: "apps" },
    { label: "Parity gaps", route: "/gaps", icon: "tune" },
    { label: "Ask your money", route: "/ask", icon: "comment-question" },
    { label: "PC editor", route: "/pc", icon: "laptop" },
    { label: "Money tools", route: "/moneytools", icon: "tools" },
    { label: "UI kit", route: "/showcase", icon: "palette" },
    { label: "Settings", route: "/settings", icon: "cog" },
  ] },
];

export default function HubScreen() {
  const router = useRouter();
  return (
    <Screen title="All apps" subtitle="One app, every merged screen">
      {GROUPS.map((group) => (
        <Card key={group.title}>
          <SectionTitle>{group.title}</SectionTitle>
          <Box gap={8}>
            {group.items.map((item) => (
              <Button key={item.label} label={item.label} icon={item.icon as never} variant="secondary" onPress={() => router.push(item.route as never)} />
            ))}
          </Box>
        </Card>
      ))}
      <Text variant="body5" color="muted">Screens merged from Pockaw, Dompetku, Boring Balance and Jings Finance.</Text>
    </Screen>
  );
}
