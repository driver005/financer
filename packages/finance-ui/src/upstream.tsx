import React, { useState } from "react";
import { ScrollView, View } from "react-native";
import { Badge, Box, Button, Card, Checkbox, Money, Progress, SwitchRow, Text, TextField } from "./primitives";
import { radius, spacing } from "./tokens";

/** Pockaw-style onboarding wizard. */
export function Onboarding({ steps, onDone }: { steps: { title: string; body: string }[]; onDone: () => void }) {
  const [index, setIndex] = useState(0);
  const step = steps[index];
  return (
    <Card>
      <Text variant="heading5">{step.title}</Text>
      <Text variant="body3" color="muted">{step.body}</Text>
      <Progress value={((index + 1) / steps.length) * 100} />
      <Box row gap={spacing.mdSm}>
        {index > 0 ? <Button label="Back" variant="secondary" onPress={() => setIndex(index - 1)} /> : null}
        <Button label={index === steps.length - 1 ? "Finish" : "Next"} onPress={() => index === steps.length - 1 ? onDone() : setIndex(index + 1)} />
      </Box>
    </Card>
  );
}

/** Dompetku gold holding. */
export function GoldCard({ name, grams, costCents, valueCents, profitCents }: { name: string; grams: number; costCents: number; valueCents: number; profitCents: number }) {
  return (
    <Card>
      <Box row style={{ justifyContent: "space-between" }}><Text variant="heading6">{name}</Text><Badge label={`${grams} g`} tone="primary" /></Box>
      <Money cents={valueCents} variant="numericTitle" />
      <Text variant="body4" color="muted">{`cost ${(costCents / 100).toFixed(2)} · profit `}{profitCents >= 0 ? "+" : ""}{(profitCents / 100).toFixed(2)}</Text>
    </Card>
  );
}

/** Dompetku receivables / subscriptions. */
export function ReceivableRow({ name, remainingCents, dueDate, overdue }: { name: string; remainingCents: number; dueDate: string; overdue: boolean }) {
  return (
    <Box row style={{ justifyContent: "space-between", minHeight: 48 }}>
      <Box gap={2}><Text variant="body3">{name}</Text><Text variant="body5" color="muted">{dueDate}</Text></Box>
      <Box gap={2}><Money cents={remainingCents} variant="numericMedium" />{overdue ? <Badge label="OVERDUE" tone="expense" /> : null}</Box>
    </Box>
  );
}

export function SubscriptionRow({ name, amountCents, interval, nextDate }: { name: string; amountCents: number; interval: string; nextDate: string }) {
  return (
    <Box row style={{ justifyContent: "space-between", minHeight: 48 }}>
      <Box gap={2}><Text variant="body3">{name}</Text><Text variant="body5" color="muted">{`${interval} · ${nextDate}`}</Text></Box>
      <Money cents={amountCents} variant="numericMedium" />
    </Box>
  );
}

/** Dompetku chat-command entry. */
export function ChatCommandBar({ value, onChange, onSubmit, last }: { value: string; onChange: (value: string) => void; onSubmit: () => void; last?: string }) {
  return (
    <Card>
      <Text variant="body4" color="muted">Command entry: /add 12,50 Food Lidl · /income 100 Salary · /undo</Text>
      <TextField label="Command" value={value} onChangeText={onChange} placeholder="/add 12,50 Food" />
      <Button label="Run command" icon="send" onPress={onSubmit} />
      {last ? <Badge label={last} tone="primary" /> : null}
    </Card>
  );
}

/** Dompetku receipt OCR gallery (text items are local, image URI is kept on device). */
export function OcrReceiptCard({ merchant, amountCents, items, uri, onAddItem }: { merchant: string; amountCents: number; items: string[]; uri?: string; onAddItem?: () => void }) {
  return (
    <Card>
      <Box row style={{ justifyContent: "space-between" }}><Text variant="heading6">{merchant}</Text><Money cents={amountCents} variant="numericLarge" /></Box>
      {uri ? <Text variant="body5" color="muted">{uri}</Text> : null}
      {items.map((item, index) => <Text key={index} variant="body4" color="muted">{item}</Text>)}
      {onAddItem ? <Button label="Add item" variant="secondary" onPress={onAddItem} /> : null}
    </Card>
  );
}

/** Dompetku payment proof / approval queue. */
export function PaymentProofRow({ method, cents, status }: { method: string; cents: number; status: string }) {
  return (
    <Box row style={{ justifyContent: "space-between", minHeight: 44 }}>
      <Text variant="body3">{method}</Text>
      <Box gap={2}><Money cents={cents} variant="numericMedium" /><Badge label={status.toUpperCase()} tone={status === "approved" ? "income" : "muted"} /></Box>
    </Box>
  );
}

/** Jings projects. */
export function ProjectCard({ name, targetCents, items, unusedCents }: { name: string; targetCents: number; items: { name: string; cents: number; funded: boolean }[]; unusedCents: number }) {
  return (
    <Card>
      <Box row style={{ justifyContent: "space-between" }}><Text variant="heading6">{name}</Text><Money cents={targetCents} variant="numericLarge" /></Box>
      {items.map((item) => (
        <Box key={item.name} row style={{ justifyContent: "space-between" }}>
          <Text variant="body3">{item.name}</Text><Money cents={item.cents} variant="numericMedium" />
          <Badge label={item.funded ? "FUNDED" : "FUTURE"} tone={item.funded ? "income" : "muted"} />
        </Box>
      ))}
      <Text variant="body5" color="muted">{`unused: ${(unusedCents / 100).toFixed(2)}`}</Text>
    </Card>
  );
}

/** Jings bill confirmation and credit-card commitment. */
export function BillConfirmationCard({ billCents, paidCents, overage, shortfall, plan }: { billCents: number; paidCents: number; overage: number; shortfall: number; plan: string }) {
  return (
    <Card>
      <Text variant="heading6">Bill confirmation</Text>
      <Text variant="body4" color="muted">{`bill ${(billCents / 100).toFixed(2)} · paid ${(paidCents / 100).toFixed(2)}`}</Text>
      <Box row gap={spacing.mdSm}>
        <Badge label={`overage ${(overage / 100).toFixed(2)}`} tone="income" />
        <Badge label={`shortfall ${(shortfall / 100).toFixed(2)}`} tone="expense" />
      </Box>
      <Text variant="body4">{plan}</Text>
    </Card>
  );
}

export function CreditCommitmentCard({ name, balanceCents, months, interestCents }: { name: string; balanceCents: number; months: number; interestCents: number }) {
  return (
    <Card>
      <Box row style={{ justifyContent: "space-between" }}><Text variant="heading6">{name}</Text><Money cents={balanceCents} variant="numericLarge" /></Box>
      <Text variant="body4" color="muted">{`${months} months to clear · interest ${(interestCents / 100).toFixed(2)}`}</Text>
    </Card>
  );
}

/** Boring Balance Excel import hint. */
export function ExcelImportCard({ onPick }: { onPick: () => void }) {
  return (
    <Card>
      <Text variant="heading6">Excel import</Text>
      <Text variant="body4" color="muted">Pick a locally exported XLSX workbook. Rows are converted to transactions on this device.</Text>
      <Button label="Pick XLSX file" icon="file-excel" onPress={onPick} />
    </Card>
  );
}
