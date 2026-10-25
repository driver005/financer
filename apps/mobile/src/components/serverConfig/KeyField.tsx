import { useState } from "react";
import { Text as RNText, View } from "react-native";

import { ChunkyButton } from "@/components/kit";
import { ChoiceControl, ListControl, TextControl, ToggleControl } from "@/components/serverConfig/Controls";
import { TableControl } from "@/components/serverConfig/TableControl";
import { FieldMessage } from "@/components/settings/SettingsKit";
import {
  editable,
  isDirty,
  sourceLabel,
  sourceTone,
  valueSummary,
  type ConfigKey,
  type Draft,
  type EditorValue,
  type Row,
} from "@/serverConfig";
import { usePalette } from "@/theme";

/** "Set in the app", "From financer.toml", "Default: 24" or "Set by FINANCER_BIND on the server". */
function SourcePill({ k }: { k: ConfigKey }) {
  const p = usePalette();
  const tone = sourceTone(k);
  const color = tone === "app" ? p.accent : tone === "locked" ? p.warn : p.muted;
  return (
    <RNText style={{ color, fontSize: 12, marginTop: 2 }} accessibilityLabel={`Source: ${sourceLabel(k)}`}>
      {sourceLabel(k)}
    </RNText>
  );
}

/**
 * One key of the server's configuration, with the editor for its kind. A key an environment
 * variable decides is shown but cannot be edited; a key set from the app can be reset to what the
 * file or the default says.
 */
export function KeyField({
  k,
  draft,
  value,
  problem,
  onChange,
  onClear,
  onReset,
  onUndo,
}: {
  k: ConfigKey;
  draft: Draft;
  value: EditorValue;
  problem?: string;
  onChange: (next: EditorValue) => void;
  onClear: () => void;
  onReset: () => void;
  onUndo: () => void;
}) {
  const p = usePalette();
  const [replacing, setReplacing] = useState(false);
  const dirty = isDirty(k, draft);
  const resetting = draft.reset.includes(k.path);
  const cleared = draft.set[k.path] === null;

  let control: React.ReactNode;
  if (!editable(k)) {
    control = (
      <RNText style={{ color: p.text, fontSize: 15, marginTop: 6 }}>
        {valueSummary(k)}
        {"\n"}
        <RNText style={{ color: p.muted, fontSize: 13 }}>Change it where {k.env} is set on the server.</RNText>
      </RNText>
    );
  } else if (resetting) {
    control = <FieldMessage>Back to {k.source === "app" ? "the file or the default" : "the default"} once you save.</FieldMessage>;
  } else if (k.kind === "secret") {
    const typed = typeof value === "string" ? value : "";
    if (cleared) {
      control = <FieldMessage>It will be removed once you save.</FieldMessage>;
    } else if (k.is_set && !replacing && typed === "") {
      control = (
        <View style={{ marginTop: 6 }}>
          <RNText style={{ color: p.text, fontSize: 15 }}>{k.preview ?? "Set (hidden)"}</RNText>
          <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
            <ChunkyButton compact outline label="Replace" icon="pencil-outline" onPress={() => setReplacing(true)} />
            <ChunkyButton compact outline label="Remove" icon="delete-outline" onPress={onClear} />
          </View>
        </View>
      );
    } else {
      control = (
        <TextControl
          label={k.label}
          value={typed}
          onChange={onChange}
          secure
          showLabel={false}
          placeholder={k.placeholder ?? (k.is_set ? "New value" : undefined)}
          error={!!problem}
          hint="Saved on the server and never shown again."
        />
      );
    }
  } else if (k.kind === "toggle") {
    control = <ToggleControl label={k.label} value={value === true} onChange={onChange} />;
  } else if (k.kind === "choice") {
    control = <ChoiceControl label={k.label} options={k.options} value={String(value)} onChange={onChange} />;
  } else if (k.kind === "list") {
    control = <ListControl label={k.label} items={Array.isArray(value) ? (value as string[]) : []} onChange={onChange} placeholder={k.placeholder ?? undefined} />;
  } else if (k.kind === "table") {
    control = <TableControl k={k} rows={Array.isArray(value) ? (value as Row[]) : []} onChange={onChange} />;
  } else {
    const range = k.kind === "number" && k.min != null && k.max != null ? `${k.min} to ${k.max}` : undefined;
    control = (
      <TextControl
        label={k.label}
        value={typeof value === "string" ? value : ""}
        onChange={onChange}
        numeric={k.kind === "number"}
        showLabel={false}
        placeholder={k.placeholder ?? k.default ?? undefined}
        error={!!problem}
        hint={range}
      />
    );
  }

  return (
    <View style={{ paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: p.border }}>
      <RNText accessibilityRole="header" style={{ color: p.text, fontSize: 15, fontWeight: "700" }}>
        {k.label}
      </RNText>
      <SourcePill k={k} />
      {k.help ? <RNText style={{ color: p.muted, fontSize: 13, marginTop: 4 }}>{k.help}</RNText> : null}
      {control}
      {problem ? <FieldMessage tone="error">{problem}</FieldMessage> : null}
      {dirty && k.warning ? <FieldMessage tone="error">{k.warning}</FieldMessage> : null}
      {editable(k) ? (
        <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
          {dirty ? <ChunkyButton compact flat label="Undo" icon="undo" onPress={() => { setReplacing(false); onUndo(); }} /> : null}
          {k.source === "app" && !dirty ? <ChunkyButton compact flat label="Reset" icon="restore" onPress={onReset} accessibilityLabel={`Reset ${k.label} to the file or the default`} /> : null}
        </View>
      ) : null}
    </View>
  );
}
