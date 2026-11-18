import React, { useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import {
  BalanceCard, Badge, Box, BudgetCard, Button, Card, CategoryDonut, Chip, CompareRow,
  DayScroller, EnvelopeList, FloatingBottomNav, GoalCard,
  InvoiceCard, EmptyState, Money, ObligationRow, PaycheckWaterfall, PlanCard, Progress,
  RecurringRow, Segmented, Skeleton, Sparkline, StatCard, SwitchRow, TextField, TransactionTile,
  ValuationRow, WalletSwitcher, darkTheme, lightTheme, type FinanceTransaction,
  FinanceUIProvider,
} from "@finance/ui";
import { IconButton as AppIconButton, Screen, SectionTitle, Text } from "../ui/primitives";

const TRANSACTIONS: FinanceTransaction[] = [
  { id: 1, title: "REWE", amountCents: 2340, kind: "expense", category: "Groceries", date: "18 Nov", icon: "cart" },
  { id: 2, title: "Salary", amountCents: 245000, kind: "income", category: "Income", date: "01 Nov", icon: "cash" },
  { id: 3, title: "Bus ticket", amountCents: 290, kind: "expense", category: "Transport", date: "17 Nov", icon: "bus" },
];

export default function ShowcaseScreen() {
  const router = useRouter();
  const [dark, setDark] = useState(false);
  const [tab, setTab] = useState("home");
  const [day, setDay] = useState("18");
  const [hidden, setHidden] = useState(false);
  const theme = dark ? darkTheme : lightTheme;
  const [confirmSplit, setConfirmSplit] = useState(false);

  return (
    <FinanceUIProvider theme={theme}>
      <View style={{ flex: 1, backgroundColor: theme.background }}>
        <Screen
          title="UI kit"
          subtitle="Pockaw base + Dompetku, Boring Balance, Jings"
          back={<AppIconButton icon="arrow-left" label="Back" onPress={() => router.back()} />}
        >
          <SwitchRow label="Dark theme" value={dark} onChange={setDark} />
          <BalanceCard
            balanceCents={183400} incomeCents={245000} expenseCents={61600}
            incomeDelta={4.2} expenseDelta={-2.1} wallet="Main wallet · EUR"
            onToggleVisibility={() => setHidden(!hidden)} hidden={hidden}
          />
          <Box row gap={12}>
            <StatCard label="Net worth" cents={842000} caption="accounts + valuations" />
            <StatCard label="This month" cents={61600} tone="expense" caption="spent" />
          </Box>
          <Card>
            <SectionTitle>Primitives</SectionTitle>
            <Box row gap={8}>
              <Button label="Primary" icon="check" onPress={() => {}} />
              <Button label="Outlined" variant="outlined" onPress={() => {}} />
              <Chip label="Active" selected onPress={() => {}} />
              <Badge label="INCOME" tone="income" />
            </Box>
            <Segmented value={tab} onChange={setTab} options={[{ value: "home", label: "Home" }, { value: "report", label: "Report" }]} />
            <TextField label="Amount" value="12,50" onChangeText={() => {}} numeric />
            <Progress value={64} />
            <EmptyState title="Nothing here" message="Add a transaction to begin." action={{ label: "Add", onPress: () => setConfirmSplit(true) }} />
          </Card>
          <Card>
            <SectionTitle>Pockaw transactions</SectionTitle>
            {TRANSACTIONS.map((transaction) => <TransactionTile key={transaction.id} transaction={transaction} />)}
          </Card>
          <CategoryDonut data={[
            { label: "Groceries", cents: 23400 }, { label: "Transport", cents: 12900 },
            { label: "Leisure", cents: 8300 }, { label: "Bills", cents: 17000 },
          ]} total={61600} />
          <Card>
            <SectionTitle>Jings day scroller</SectionTitle>
            <DayScroller days={[{ key: "17", label: "Mo" }, { key: "18", label: "Tu", active: true }, { key: "19", label: "We" }, { key: "20", label: "Th" }]} active={day} onChange={setDay} />
            <Sparkline points={[12, 18, 9, 22, 17, 25, 20]} />
          </Card>
          <PaycheckWaterfall takeHomeCents={245000} steps={[
            { label: "Fixed bills", cents: 90000, kind: "fixed" },
            { label: "Envelopes", cents: 45000, kind: "envelope" },
            { label: "Plan saving", cents: 30000, kind: "plan" },
            { label: "Investment", cents: 20000, kind: "invest" },
            { label: "Guilt-free", cents: 60000, kind: "leftover" },
          ]} />
          <EnvelopeList envelopes={[
            { id: "e1", name: "Food", balanceCents: 18000, limitCents: 25000, rollover: true },
            { id: "e2", name: "Fuel", balanceCents: 4000, limitCents: 10000 },
          ]} />
          <GoalCard goal={{ id: "g1", title: "Holiday", targetCents: 100000, savedCents: 42000, pinned: true, items: [
            { id: "i1", title: "Flight", amountCents: 30000, completed: true },
            { id: "i2", title: "Hotel", amountCents: 25000, completed: false },
          ] }} />
          <BudgetCard category="Groceries" spentCents={23000} limitCents={25000} rolloverCents={1200} />
          <Card>
            <SectionTitle>Boring Balance / Dompetku</SectionTitle>
            <RecurringRow name="Rent" nextDate="01 Dec" cents={90000} />
            <ObligationRow name="Phone" remainingCents={24000} dueDate="05 Dec" kind="subscription" />
            <ValuationRow label="Brokerage" valueCents={310000} changeCents={4200} />
            <CompareRow label="Groceries" currentCents={23000} previousCents={19000} />
          </Card>
          <InvoiceCard number="INV-012" customer="Max Mustermann" totalCents={14900} status="paid" />
          <PlanCard title="Emergency fund" targetCents={200000} savedCents={85000} pace="8 paychecks left" />
          <Card>
            <SectionTitle>Wallets (multi-currency)</SectionTitle>
            <WalletSwitcher wallets={[{ id: "eur", name: "Bank", currency: "EUR" }, { id: "usd", name: "Cash", currency: "USD" }]} active="eur" onChange={() => {}} />
            <Money cents={125000} variant="numericLarge" />
          </Card>
          <Skeleton rows={2} />
        </Screen>
        <FloatingBottomNav
          items={[
            { key: "home", label: "Home", icon: "home" },
            { key: "log", label: "Log", icon: "receipt" },
            { key: "goals", label: "Goals", icon: "target" },
            { key: "reports", label: "Reports", icon: "chart-bar" },
          ]}
          active={tab === "home" ? "home" : "reports"}
          onChange={setTab}
          onAdd={() => setConfirmSplit(true)}
        />
      </View>
    </FinanceUIProvider>
  );
}

