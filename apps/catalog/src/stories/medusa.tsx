import { useState } from "react";

import {
  Alert, Box, Button, Code, Command, CommandBar, Container, CurrencyInput, Drawer, DropdownMenu, FocusModal, Heading, MedusaIconBadge, InlineTip, Kbd, Label,
  OTPInput, Popover, ProgressAccordion, ProgressTabs, Prompt, RadioGroup, Row, Select, Stack, StatusBadge, Table, Tabs, Text, Textarea, ToastProvider,
  Tooltip, useToast, type MedusaColor, type StepStatus,
} from "@financer/ui";

import type { StoryDef } from "../Story";

const COLORS: MedusaColor[] = ["green", "red", "blue", "orange", "purple", "grey"];

function Basics() {
  return (
    <Stack gap="lg">
      <Container>
        <Box p="lg" gap="sm">
          <Heading level="h1">Heading one</Heading>
          <Heading level="h2">Heading two</Heading>
          <Heading level="h3">Heading three</Heading>
          <Row gap="md" wrap>
            <Label size="small">Small</Label>
            <Label>Base</Label>
            <Label size="large" weight="plus">Large plus</Label>
            <Kbd>⌘K</Kbd>
            <Code>medusa.config</Code>
          </Row>
        </Box>
      </Container>
      <Row gap="sm" wrap>
        {COLORS.map((c) => <StatusBadge key={c} color={c}>{c}</StatusBadge>)}
      </Row>
      <Row gap="sm" wrap>
        {COLORS.map((c) => <MedusaIconBadge key={c} icon="bell-alert" color={c} />)}
        <MedusaIconBadge icon="credit-card" color="blue" large />
      </Row>
      <InlineTip>Prices include VAT when the region says so.</InlineTip>
      <InlineTip variant="warning" label="Careful">This cannot be undone.</InlineTip>
      <Alert variant="success" title="Saved">Your changes are stored.</Alert>
      <Alert variant="error">The payment was declined.</Alert>
    </Stack>
  );
}

function Forms() {
  const [note, setNote] = useState("");
  const [amount, setAmount] = useState("19.90");
  const [plan, setPlan] = useState("pro");
  const [country, setCountry] = useState<"de" | "fr" | "nl" | undefined>("de");
  const [code, setCode] = useState("");
  return (
    <Stack gap="lg">
      <Textarea label="Note" value={note} onChangeText={setNote} placeholder="Write a note" />
      <CurrencyInput label="Price" code="eur" value={amount} onChangeText={setAmount} />
      <RadioGroup value={plan} onValueChange={setPlan}>
        <RadioGroup.Item value="free" label="Free" description="One user" />
        <RadioGroup.Item value="pro" label="Pro" description="Ten users" />
      </RadioGroup>
      <Select label="Country" value={country} onValueChange={setCountry} options={[{ value: "de", label: "Germany" }, { value: "fr", label: "France" }, { value: "nl", label: "Netherlands" }]} />
      <OTPInput value={code} onChange={setCode} />
    </Stack>
  );
}

function Navigation() {
  const [tab, setTab] = useState("details");
  const [step, setStep] = useState("address");
  const STEPS: { value: string; label: string; status: StepStatus }[] = [
    { value: "address", label: "Address", status: "completed" },
    { value: "shipping", label: "Shipping", status: "in-progress" },
    { value: "payment", label: "Payment", status: "not-started" },
  ];
  return (
    <Stack gap="xl">
      <Tabs tabs={[{ value: "details", label: "Details" }, { value: "orders", label: "Orders" }, { value: "notes", label: "Notes" }]} value={tab} onValueChange={setTab}>
        <Text variant="bodySmall">Panel: {tab}</Text>
      </Tabs>
      <ProgressTabs tabs={STEPS} value={step} onValueChange={setStep}>
        <Text variant="bodySmall">Step: {step}</Text>
      </ProgressTabs>
      <ProgressAccordion defaultValue="a" items={[{ value: "a", title: "Customer", status: "completed", children: <Text variant="bodySmall">Ada Lovelace</Text> }, { value: "b", title: "Shipping", status: "in-progress", children: <Text variant="bodySmall">Standard, 2 days</Text> }]} />
      <Container>
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>Product</Table.HeaderCell>
              <Table.HeaderCell>Stock</Table.HeaderCell>
              <Table.HeaderCell end>Price</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            <Table.Row><Table.Cell>Shirt</Table.Cell><Table.Cell>12</Table.Cell><Table.Cell end>19,90 €</Table.Cell></Table.Row>
            <Table.Row><Table.Cell>Cap</Table.Cell><Table.Cell>0</Table.Cell><Table.Cell end>12,00 €</Table.Cell></Table.Row>
          </Table.Body>
        </Table>
      </Container>
    </Stack>
  );
}

function Notify() {
  const toast = useToast();
  return (
    <Row gap="sm" wrap>
      <Button label="Info" variant="soft" onPress={() => toast({ title: "Heads up", description: "Something to know." })} />
      <Button label="Success" tone="success" variant="soft" onPress={() => toast({ title: "Saved", variant: "success" })} />
      <Button label="Error" tone="danger" variant="soft" onPress={() => toast({ title: "Failed", description: "Try again.", variant: "error" })} />
    </Row>
  );
}

function Overlays() {
  const [drawer, setDrawer] = useState(false);
  const [focus, setFocus] = useState(false);
  const [prompt, setPrompt] = useState(false);
  const [command, setCommand] = useState(false);
  const [chosen, setChosen] = useState(2);
  return (
    <ToastProvider>
      <Stack gap="lg">
        <Notify />
        <Row gap="sm" wrap>
          <Popover label="Open popover" trigger={<Button label="Popover" variant="outline" />}>
            <Text variant="bodySmall">Any content can sit in a popover.</Text>
          </Popover>
          <Tooltip content="Long press shows this">
            <Button label="Tooltip" variant="outline" />
          </Tooltip>
          <DropdownMenu label="Open menu" trigger={<Button label="Menu" variant="outline" />} items={[{ label: "Edit", icon: "pencil-outline", onPress: () => {} }, "separator", { label: "Delete", icon: "delete-outline", danger: true, onPress: () => {} }]} />
        </Row>
        <Row gap="sm" wrap>
          <Button label="Drawer" variant="soft" onPress={() => setDrawer(true)} />
          <Button label="Focus modal" variant="soft" onPress={() => setFocus(true)} />
          <Button label="Prompt" variant="soft" tone="danger" onPress={() => setPrompt(true)} />
          <Button label="Command" variant="soft" onPress={() => setCommand(true)} />
        </Row>
        <CommandBar count={chosen} onClear={() => setChosen(0)} actions={[{ label: "Edit", onPress: () => {} }, { label: "Delete", onPress: () => {} }]} />
        <Drawer open={drawer} onOpenChange={setDrawer} title="Edit product"><Text variant="bodySmall">Fields go here.</Text></Drawer>
        <FocusModal open={focus} onOpenChange={setFocus} title="Create product" actions={<Button label="Save" size="sm" onPress={() => setFocus(false)} />}>
          <Text variant="bodySmall">A whole-screen task.</Text>
        </FocusModal>
        <Prompt open={prompt} onOpenChange={setPrompt} title="Delete the product?" description="This cannot be undone." variant="danger" confirmText="Delete" onConfirm={() => {}} />
        <Command open={command} onOpenChange={setCommand} items={[{ id: "p", label: "Go to products", icon: "tag-outline", hint: "G P", onSelect: () => {} }, { id: "o", label: "Go to orders", icon: "package-variant-closed", hint: "G O", onSelect: () => {} }]} />
      </Stack>
    </ToastProvider>
  );
}

export const medusaStories: StoryDef[] = [
  { id: "medusa-basics", title: "Basics", note: "Container, Heading, Label, Kbd, Code, StatusBadge, IconBadge, InlineTip, Alert: Medusa's, on tokens.", render: () => <Basics /> },
  { id: "medusa-forms", title: "Forms", note: "Textarea, CurrencyInput, RadioGroup, Select (opens a sheet) and OTPInput.", render: () => <Forms /> },
  { id: "medusa-nav", title: "Tabs, steps and table", note: "Tabs, ProgressTabs, ProgressAccordion and Table with Header, Body, Row, Cell.", render: () => <Navigation /> },
  { id: "medusa-overlays", title: "Overlays and messages", note: "Popover, Tooltip (long press), DropdownMenu, Drawer, FocusModal, Prompt, Command, CommandBar and toasts.", render: () => <Overlays /> },
];
