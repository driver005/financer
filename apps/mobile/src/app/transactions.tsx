import React, { useEffect, useState } from "react";
import { ScrollView, View } from "react-native";
import { useRouter } from "expo-router";
import { Badge, Box, Button, Card, DayScroller, EmptyState, Money, Segmented, Text, TextField } from "@finance/ui";
import { IconButton as AppIconButton, Screen, SectionTitle } from "../ui/primitives";
import { core } from "../rust/core";
import { allTransactions, accounts } from "../db/moneyTracker";
import { CategoryAssetIcon } from "@finance/ui";

type Row = { id: number; date: string; merchant: string; amountCents: number; category: string; kind?: string; accountId?: string };

export default function TransactionsScreen() {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([]);
  const [mode, setMode] = useState<"list" | "table">("list");
  const [filter, setFilter] = useState("");
  const [day, setDay] = useState("today");

  const load = () => void allTransactions().then((data) => setRows(data as unknown as Row[]));
  useEffect(load, []);

  const visible = rows.filter((r) => r.merchant.toLowerCase().includes(filter.toLowerCase()) || r.category.toLowerCase().includes(filter.toLowerCase()));

  return (
    <Screen title="Transactions" subtitle="List, table and quick add" action={<AppIconButton icon="plus" label="Add transaction" onPress={() => router.push("/quickadd")} />}>
      <Card>
        <Segmented value={mode} onChange={setMode} options={[{ value: "list", label: "List" }, { value: "table", label: "Table" }]} />
        <TextField label="Search" value={filter} onChangeText={setFilter} placeholder="Merchant or category" />
        <DayScroller days={["M", "T", "W", "T", "F", "S", "S"].map((label, i) => ({ key: String(i), label }))} active={day} onChange={setDay} />
      </Card>
      <Card>
        <SectionTitle>{mode === "list" ? "Recent" : "Editable table"}</SectionTitle>
        {visible.slice(0, 40).map((row) => (
          <Box key={row.id} row gap={12} style={{ minHeight: 56, borderBottomWidth: 1, borderBottomColor: "#E8E8E8" }}>
            <CategoryAssetIcon category={row.category} size={40} />
            <Box style={{ flex: 1 }}>
              <Text variant="body3">{row.merchant}</Text>
              <Text variant="body5" color="muted">{`${row.date} · ${row.category} · ${row.kind ?? "expense"}`}</Text>
            </Box>
            <Money cents={row.amountCents} variant="numericMedium" color={row.kind === "income" ? "income" : undefined} />
            {mode === "table" ? <Button label="Edit" variant="secondary" onPress={() => router.push("/pc")} /> : null}
          </Box>
        ))}
        {!visible.length ? <EmptyState title="No transactions yet" message="Add one with the + button, import a CSV, or connect a provider." icon="receipt" action={{ label: "Add transaction", onPress: () => router.push("/quickadd") }} /> : null}
      </Card>
      <Button label="Open full PC editor" icon="laptop" variant="secondary" onPress={() => router.push("/pc")} />
    </Screen>
  );
}
