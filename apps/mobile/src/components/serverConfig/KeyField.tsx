import { useState, type ReactNode } from "react";
import { Box, Button, Note, Row, Text } from "@financer/ui";

import { ChoiceControl, ListControl, TextControl, ToggleControl } from "@/components/serverConfig/Controls";
import { TableControl } from "@/components/serverConfig/TableControl";
import { editable, isDirty, sourceLabel, sourceTone, valueSummary, type ConfigKey, type Draft, type EditorValue, type Row as ConfigRow } from "@/serverConfig";

/** "Set in the app", "From financer.toml", "Default: 24" or "Set by FINANCER_BIND on the server". */
function SourcePill({ k }: { k: ConfigKey }) {
  const tone = sourceTone(k);
  return (
    <Text variant="caption" tone={tone === "app" ? "accent" : tone === "locked" ? "warning" : "muted"} accessibilityLabel={`Source: ${sourceLabel(k)}`}>
      {sourceLabel(k)}
    </Text>
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
  const [replacing, setReplacing] = useState(false);
  const dirty = isDirty(k, draft);
  const resetting = draft.reset.includes(k.path);
  const cleared = draft.set[k.path] === null;

  let control: ReactNode;
  if (!editable(k)) {
    control = (
      <Box gap="2xs">
        <Text variant="body">{valueSummary(k)}</Text>
        <Text variant="caption" tone="muted">{`Change it where ${k.env} is set on the server.`}</Text>
      </Box>
    );
  } else if (resetting) {
    control = <Note>{`Back to ${k.source === "app" ? "the file or the default" : "the default"} once you save.`}</Note>;
  } else if (k.kind === "secret") {
    const typed = typeof value === "string" ? value : "";
    if (cleared) {
      control = <Note>It will be removed once you save.</Note>;
    } else if (k.is_set && !replacing && typed === "") {
      control = (
        <Box gap="sm">
          <Text variant="body">{k.preview ?? "Set (hidden)"}</Text>
          <Row gap="sm">
            <Button size="sm" variant="outline" label="Replace" icon="pencil-outline" onPress={() => setReplacing(true)} />
            <Button size="sm" variant="outline" label="Remove" icon="delete-outline" onPress={onClear} />
          </Row>
        </Box>
      );
    } else {
      control = <TextControl label={k.label} value={typed} onChange={onChange} secure showLabel={false} placeholder={k.placeholder ?? (k.is_set ? "New value" : undefined)} error={problem} hint="Saved on the server and never shown again." />;
    }
  } else if (k.kind === "toggle") {
    control = <ToggleControl label={k.label} value={value === true} onChange={onChange} />;
  } else if (k.kind === "choice") {
    control = <ChoiceControl label={k.label} options={k.options} value={String(value)} onChange={onChange} />;
  } else if (k.kind === "list") {
    control = <ListControl label={k.label} items={Array.isArray(value) ? (value as string[]) : []} onChange={onChange} placeholder={k.placeholder ?? undefined} />;
  } else if (k.kind === "table") {
    control = <TableControl k={k} rows={Array.isArray(value) ? (value as ConfigRow[]) : []} onChange={onChange} />;
  } else {
    const range = k.kind === "number" && k.min != null && k.max != null ? `${k.min} to ${k.max}` : undefined;
    control = <TextControl label={k.label} value={typeof value === "string" ? value : ""} onChange={onChange} numeric={k.kind === "number"} showLabel={false} placeholder={k.placeholder ?? k.default ?? undefined} error={problem} hint={range} />;
  }

  return (
    <Box gap="sm" py="md">
      <Box gap="2xs">
        <Text variant="bodyStrong" level={3}>{k.label}</Text>
        <SourcePill k={k} />
      </Box>
      {k.help ? <Text variant="caption" tone="muted">{k.help}</Text> : null}
      {control}
      {problem && !(k.kind === "secret" || k.kind === "string" || k.kind === "number") ? <Note tone="error">{problem}</Note> : null}
      {dirty && k.warning ? <Note tone="error">{k.warning}</Note> : null}
      {editable(k) ? (
        <Row gap="sm">
          {dirty ? (
            <Button
              size="sm"
              variant="ghost"
              label="Undo"
              icon="undo"
              onPress={() => {
                setReplacing(false);
                onUndo();
              }}
            />
          ) : null}
          {k.source === "app" && !dirty ? <Button size="sm" variant="ghost" label="Reset" icon="restore" onPress={onReset} /> : null}
        </Row>
      ) : null}
    </Box>
  );
}
