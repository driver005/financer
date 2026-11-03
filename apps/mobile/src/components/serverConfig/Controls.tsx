/**
 * Small form controls for the Server settings screen: a text box, a list of text boxes, a choice
 * and a switch. They know nothing about the server's keys; `KeyField` and `TableControl` put them
 * together from what the server describes.
 */
import { Box, Button, Chip, ChipRow, IconButton, Row, Segmented, Switch, Text, TextField, Touchable } from "@financer/ui";

import { tap } from "@/native/haptics";

export function TextControl({
  label,
  value,
  onChange,
  placeholder,
  secure,
  numeric,
  error,
  hint,
  showLabel = true,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  secure?: boolean;
  numeric?: boolean;
  error?: string | boolean;
  hint?: string;
  /** False when a heading right above already says what the box is for. */
  showLabel?: boolean;
}) {
  return (
    <TextField
      label={showLabel ? label : undefined}
      value={value}
      onChangeText={onChange}
      placeholder={placeholder ?? (showLabel ? undefined : label)}
      secure={secure}
      keyboardType={numeric ? "number-pad" : "default"}
      error={typeof error === "string" ? error : error ? " " : undefined}
      helper={hint}
    />
  );
}

export function ToggleControl({ label, value, onChange }: { label: string; value: boolean; onChange: (next: boolean) => void }) {
  return (
    <Touchable
      onPress={() => {
        tap();
        onChange(!value);
      }}
      label={label}
      role="switch"
      selected={value}
      direction="row"
      align="center"
      justify="between"
      gap="md"
      touch
    >
      <Text variant="body">{value ? "On" : "Off"}</Text>
      <Box pointerEvents="none">
        <Switch value={value} onChange={() => {}} label={label} />
      </Box>
    </Touchable>
  );
}

export function ChoiceControl({ label, options, value, onChange }: { label: string; options: readonly string[]; value: string; onChange: (next: string) => void }) {
  if (options.length <= 3) {
    return <Segmented value={value} onChange={onChange} options={options.map((o) => ({ value: o, label: o }))} />;
  }
  return (
    <ChipRow>
      {options.map((o) => (
        <Chip key={o} label={o} selected={o === value} onPress={() => onChange(o)} />
      ))}
    </ChipRow>
  );
}

/** A list of texts: one box each, a remove button beside it and an "Add" button below. */
export function ListControl({ label, items, onChange, placeholder }: { label: string; items: string[]; onChange: (next: string[]) => void; placeholder?: string }) {
  return (
    <Box gap="sm">
      {items.map((item, i) => (
        <Row key={i} gap="xs" align="end">
          <Box grow>
            <TextControl label={`${label} ${i + 1}`} value={item} placeholder={placeholder} onChange={(v) => onChange(items.map((x, j) => (j === i ? v : x)))} />
          </Box>
          <IconButton icon="delete-outline" label={`Remove ${label} ${i + 1}`} onPress={() => onChange(items.filter((_, j) => j !== i))} />
        </Row>
      ))}
      <Row><Button size="sm" variant="outline" icon="plus" label="Add" onPress={() => onChange([...items, ""])} /></Row>
    </Box>
  );
}
