/**
 * Small form controls for the Server settings screen: a text box, a list of text boxes, a choice
 * and a switch. They know nothing about the server's keys; `KeyField` and `TableControl` put them
 * together from what the server describes.
 */
import { Pressable, Text as RNText, View } from "react-native";

import { ChunkyButton, Switch, TextInput } from "@/components/kit";
import { ChoiceChips, IconAction, Segmented } from "@/components/settings/SettingsKit";
import { tap } from "@/native/haptics";
import { usePalette } from "@/theme";

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
  error?: boolean;
  hint?: string;
  /** False when a heading right above already says what the box is for (it stays its accessibility label). */
  showLabel?: boolean;
}) {
  const p = usePalette();
  return (
    <View style={{ marginTop: 8 }}>
      <TextInput
        mode="outlined"
        label={showLabel ? label : undefined}
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        secureTextEntry={secure}
        keyboardType={numeric ? "number-pad" : "default"}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete={secure ? "off" : undefined}
        error={error}
      />
      {hint ? <RNText style={{ color: p.muted, fontSize: 12, marginTop: 4 }}>{hint}</RNText> : null}
    </View>
  );
}

export function ToggleControl({ label, value, onChange }: { label: string; value: boolean; onChange: (next: boolean) => void }) {
  const p = usePalette();
  return (
    <Pressable
      onPress={() => {
        tap();
        onChange(!value);
      }}
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value }}
      style={{ minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 4 }}
    >
      <RNText style={{ color: p.text, fontSize: 15 }}>{value ? "On" : "Off"}</RNText>
      <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Switch value={value} onValueChange={() => {}} accessibilityLabel={label} />
      </View>
    </Pressable>
  );
}

export function ChoiceControl({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly string[];
  value: string;
  onChange: (next: string) => void;
}) {
  if (options.length <= 3) {
    return <Segmented style={{ marginTop: 8 }} value={value} onValueChange={onChange} buttons={options.map((o) => ({ value: o, label: o }))} />;
  }
  return (
    <View style={{ marginTop: 8 }}>
      <ChoiceChips options={options} value={value} onChange={onChange} groupLabel={label} />
    </View>
  );
}

/** A list of texts: one box each, a remove button beside it and an "Add" button below. */
export function ListControl({
  label,
  items,
  onChange,
  placeholder,
}: {
  label: string;
  items: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}) {
  return (
    <View style={{ marginTop: 4 }}>
      {items.map((item, i) => (
        <View key={i} style={{ flexDirection: "row", alignItems: "flex-end", gap: 4 }}>
          <View style={{ flex: 1 }}>
            <TextControl
              label={`${label} ${i + 1}`}
              value={item}
              placeholder={placeholder}
              onChange={(v) => onChange(items.map((x, j) => (j === i ? v : x)))}
            />
          </View>
          <IconAction icon="delete-outline" label={`Remove ${label} ${i + 1}`} onPress={() => onChange(items.filter((_, j) => j !== i))} />
        </View>
      ))}
      <ChunkyButton
        compact
        outline
        icon="plus"
        label="Add"
        accessibilityLabel={`Add to ${label}`}
        onPress={() => onChange([...items, ""])}
        style={{ marginTop: 8, alignSelf: "flex-start" }}
      />
    </View>
  );
}
