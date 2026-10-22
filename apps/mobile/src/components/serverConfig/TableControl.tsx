import { Text as RNText, View } from "react-native";

import { ChunkyButton } from "@/components/kit";
import { ChoiceControl, ListControl, TextControl, ToggleControl } from "@/components/serverConfig/Controls";
import { IconAction } from "@/components/settings/SettingsKit";
import {
  emptyRow,
  entryNoun,
  entryTitle,
  fieldVisible,
  type ConfigField,
  type ConfigKey,
  type Row,
} from "@/serverConfig";
import { usePalette } from "@/theme";

/** One column of an entry, drawn by its kind. */
function FieldControl({ field, value, onChange }: { field: ConfigField; value: string | boolean | string[]; onChange: (next: string | boolean | string[]) => void }) {
  const p = usePalette();
  const hint = [field.help, field.kind === "number" && field.min != null && field.max != null ? `${field.min} to ${field.max}` : ""].filter(Boolean).join(" ");
  if (field.kind === "toggle") {
    return (
      <View style={{ marginTop: 8 }}>
        <RNText style={{ color: p.muted, fontSize: 13 }}>{field.label}</RNText>
        {field.help ? <RNText style={{ color: p.muted, fontSize: 12, marginTop: 2 }}>{field.help}</RNText> : null}
        <ToggleControl label={field.label} value={value === true} onChange={onChange} />
      </View>
    );
  }
  if (field.kind === "choice") {
    return (
      <View style={{ marginTop: 8 }}>
        <RNText style={{ color: p.muted, fontSize: 13 }}>{field.label}</RNText>
        <ChoiceControl label={field.label} options={field.options} value={String(value)} onChange={onChange} />
      </View>
    );
  }
  if (field.kind === "list") {
    return (
      <View style={{ marginTop: 8 }}>
        <RNText style={{ color: p.muted, fontSize: 13 }}>{field.label}</RNText>
        {field.help ? <RNText style={{ color: p.muted, fontSize: 12, marginTop: 2 }}>{field.help}</RNText> : null}
        <ListControl label={field.label} items={Array.isArray(value) ? value : []} onChange={onChange} placeholder={field.placeholder ?? undefined} />
      </View>
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
export function TableControl({ k, rows, onChange }: { k: ConfigKey; rows: Row[]; onChange: (next: Row[]) => void }) {
  const p = usePalette();
  const noun = entryNoun(k);
  return (
    <View style={{ marginTop: 8 }}>
      {rows.map((row, i) => (
        <View
          key={i}
          style={{ borderWidth: 1, borderColor: p.border, borderRadius: 14, padding: 12, marginBottom: 12, backgroundColor: p.surface }}
        >
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <RNText accessibilityRole="header" style={{ flex: 1, color: p.text, fontSize: 15, fontWeight: "700" }}>
              {entryTitle(k, row, i)}
            </RNText>
            <IconAction icon="delete-outline" tone="danger" label={`Remove ${noun} ${i + 1}`} onPress={() => onChange(rows.filter((_, j) => j !== i))} />
          </View>
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
        </View>
      ))}
      <ChunkyButton compact outline icon="plus" label={`Add ${noun}`} onPress={() => onChange([...rows, emptyRow(k)])} style={{ alignSelf: "flex-start" }} />
    </View>
  );
}
