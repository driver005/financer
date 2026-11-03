import { Box, Button, Card, IconButton, Row, Text } from "@financer/ui";

import { ChoiceControl, ListControl, TextControl, ToggleControl } from "@/components/serverConfig/Controls";
import { emptyRow, entryNoun, entryTitle, fieldVisible, type ConfigField, type ConfigKey, type Row as ConfigRow } from "@/serverConfig";

/** One column of an entry, drawn by its kind. */
function FieldControl({ field, value, onChange }: { field: ConfigField; value: string | boolean | string[]; onChange: (next: string | boolean | string[]) => void }) {
  const hint = [field.help, field.kind === "number" && field.min != null && field.max != null ? `${field.min} to ${field.max}` : ""].filter(Boolean).join(" ");
  if (field.kind === "toggle") {
    return (
      <Box gap="xs">
        <Text variant="label" tone="muted">{field.label}</Text>
        {field.help ? <Text variant="caption" tone="muted">{field.help}</Text> : null}
        <ToggleControl label={field.label} value={value === true} onChange={onChange} />
      </Box>
    );
  }
  if (field.kind === "choice") {
    return (
      <Box gap="xs">
        <Text variant="label" tone="muted">{field.label}</Text>
        <ChoiceControl label={field.label} options={field.options} value={String(value)} onChange={onChange} />
      </Box>
    );
  }
  if (field.kind === "list") {
    return (
      <Box gap="xs">
        <Text variant="label" tone="muted">{field.label}</Text>
        {field.help ? <Text variant="caption" tone="muted">{field.help}</Text> : null}
        <ListControl label={field.label} items={Array.isArray(value) ? value : []} onChange={onChange} placeholder={field.placeholder ?? undefined} />
      </Box>
    );
  }
  return (
    <TextControl
      label={field.required ? field.label : `${field.label} (optional)`}
      value={String(value ?? "")}
      onChange={onChange}
      placeholder={field.placeholder ?? field.default ?? undefined}
      numeric={field.kind === "number"}
      hint={hint}
    />
  );
}

/** A list of entries (bank accounts, store names, senders): a card each, with Add and Remove. */
export function TableControl({ k, rows, onChange }: { k: ConfigKey; rows: ConfigRow[]; onChange: (next: ConfigRow[]) => void }) {
  const noun = entryNoun(k);
  return (
    <Box gap="md">
      {rows.map((row, i) => (
        <Card key={i} variant="outline" gap="md">
          <Row gap="sm">
            <Box grow><Text variant="bodyStrong" level={4}>{entryTitle(k, row, i)}</Text></Box>
            <IconButton icon="delete-outline" tone="danger" label={`Remove ${noun} ${i + 1}`} onPress={() => onChange(rows.filter((_, j) => j !== i))} />
          </Row>
          {k.fields
            .filter((f) => fieldVisible(k, f, row))
            .map((f) => (
              <FieldControl
                key={f.key}
                field={f}
                value={row[f.key] ?? (f.kind === "list" ? [] : f.kind === "toggle" ? false : "")}
                onChange={(v) => onChange(rows.map((r, j) => (j === i ? { ...r, [f.key]: v } : r)))}
              />
            ))}
        </Card>
      ))}
      <Row><Button size="sm" variant="outline" icon="plus" label={`Add ${noun}`} onPress={() => onChange([...rows, emptyRow(k)])} /></Row>
    </Box>
  );
}
