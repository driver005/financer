import { useState } from "react";
import { ScrollView, View } from "react-native";

import type { Rule } from "@/api/client";
import { useApi } from "@/api/config";
import { CategoryPicker } from "@/components/CategoryPicker";
import { HelperText, IconButton, SegmentedButtons, Text, TextInput } from "@/components/kit";
import { Body, Button, Card, Loading, NeedsSetup, Screen, Title, useColors } from "@/components/ui";
import { useScreenData } from "@/hooks";
import {
  EMPTY_DRAFT,
  describeRule,
  draftFromRule,
  moveId,
  ruleFromDraft,
  type MatchKind,
  type RuleDraft,
  type RuleFields,
} from "@/rules";

/** The API types enum fields as plain strings; the app narrows them. */
function fields(r: Rule): RuleFields {
  return r as RuleFields;
}

export default function Rules() {
  const { api, loaded } = useApi();
  const c = useColors();
  const { data: rules, error, reload } = useScreenData((a) => a.rules());
  const [draft, setDraft] = useState<RuleDraft | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(work: () => Promise<string | void>) {
    setBusy(true);
    try {
      const note = await work();
      setMessage(note ? { text: note, ok: true } : null);
      await reload();
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : "Something went wrong", ok: false });
    } finally {
      setBusy(false);
    }
  }

  function startAdd() {
    setEditing(null);
    setFormError(null);
    setDraft(EMPTY_DRAFT);
  }

  function startEdit(r: Rule) {
    setEditing(r.id);
    setFormError(null);
    setDraft(draftFromRule(fields(r)));
  }

  async function save() {
    if (!api || !draft) return;
    const built = ruleFromDraft(draft);
    if ("error" in built) {
      setFormError(built.error);
      return;
    }
    setBusy(true);
    try {
      if (editing === null) await api.createRule(built.rule);
      else await api.updateRule(editing, built.rule);
      setDraft(null);
      setFormError(null);
      setMessage({ text: "Rule saved. Use “Apply to existing transactions” to re-categorize what you already have.", ok: true });
      await reload();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Could not save the rule");
    } finally {
      setBusy(false);
    }
  }

  if (!loaded) return <Screen><Loading /></Screen>;

  const ids = (rules ?? []).map((r) => r.id);

  return (
    <Screen>
      <Title>Rules</Title>
      {!api ? (
        <NeedsSetup />
      ) : (
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 24 }}>
          <Text variant="bodySmall" style={{ color: c.muted, marginBottom: 12 }}>
            Rules run from top to bottom; the first match wins and beats the built-in categories. They apply to new imports and
            syncs. Transactions you categorized by hand are never changed by rules.
          </Text>

          {draft ? (
            <RuleForm
              draft={draft}
              onChange={setDraft}
              onSave={save}
              onCancel={() => setDraft(null)}
              busy={busy}
              error={formError}
              isEdit={editing !== null}
            />
          ) : (
            <View style={{ gap: 8, marginBottom: 12 }}>
              <Button label="Add a rule" icon="plus" onPress={startAdd} />
              <Button
                label="Apply to existing transactions"
                icon="refresh"
                mode="outlined"
                disabled={busy}
                onPress={() =>
                  run(async () => {
                    const r = await api.applyRules();
                    return r.changed === 0 ? "Nothing changed." : `${r.changed} transaction${r.changed === 1 ? "" : "s"} changed.`;
                  })
                }
              />
            </View>
          )}

          <HelperText type={message?.ok ? "info" : "error"} visible={!!(message ?? error)}>
            {message?.text ?? error}
          </HelperText>

          {rules === null ? (
            <Loading />
          ) : rules.length === 0 ? (
            <Body muted>No rules yet. Add one, or change a transaction's category and switch on "Remember for this merchant".</Body>
          ) : (
            rules.map((r, i) => (
              <Card key={r.id}>
                <Body bold>{describeRule(fields(r))}</Body>
                <View style={{ flexDirection: "row", justifyContent: "flex-end", marginTop: 4 }}>
                  <IconButton icon="arrow-up" accessibilityLabel="Move up (higher priority)" onPress={() => i > 0 && run(async () => void (await api.reorderRules(moveId(ids, i, -1))))} />
                  <IconButton icon="arrow-down" accessibilityLabel="Move down (lower priority)" onPress={() => i < rules.length - 1 && run(async () => void (await api.reorderRules(moveId(ids, i, 1))))} />
                  <IconButton icon="pencil-outline" accessibilityLabel="Edit rule" onPress={() => startEdit(r)} />
                  <IconButton icon="trash-can-outline" accessibilityLabel="Delete rule" onPress={() => run(async () => void (await api.deleteRule(r.id)))} />
                </View>
              </Card>
            ))
          )}
        </ScrollView>
      )}
    </Screen>
  );
}

function RuleForm({
  draft,
  onChange,
  onSave,
  onCancel,
  busy,
  error,
  isEdit,
}: {
  draft: RuleDraft;
  onChange: (d: RuleDraft) => void;
  onSave: () => void;
  onCancel: () => void;
  busy: boolean;
  error: string | null;
  isEdit: boolean;
}) {
  const set = (patch: Partial<RuleDraft>) => onChange({ ...draft, ...patch });
  return (
    <Card>
      <Text variant="titleMedium">{isEdit ? "Edit rule" : "New rule"}</Text>
      <Text variant="bodySmall" style={{ marginTop: 12 }}>If the merchant name…</Text>
      <SegmentedButtons<MatchKind>
        style={{ marginTop: 6 }}
        value={draft.kind}
        onValueChange={(kind) => set({ kind })}
        buttons={[
          { value: "contains", label: "Contains" },
          { value: "equals", label: "Is" },
          { value: "starts_with", label: "Starts" },
        ]}
      />
      <TextInput
        mode="outlined"
        label="Name"
        value={draft.pattern}
        onChangeText={(pattern) => set({ pattern })}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="e.g. kiosk"
        style={{ marginTop: 10 }}
      />
      <Text variant="bodySmall" style={{ marginTop: 12 }}>Only for…</Text>
      <SegmentedButtons<RuleDraft["sign"]>
        style={{ marginTop: 6 }}
        value={draft.sign}
        onValueChange={(sign) => set({ sign })}
        buttons={[
          { value: "any", label: "Any" },
          { value: "expense", label: "Expenses" },
          { value: "income", label: "Income" },
        ]}
      />
      <View style={{ flexDirection: "row", gap: 12, marginTop: 10 }}>
        <TextInput
          mode="outlined"
          label="From (optional)"
          value={draft.min}
          onChangeText={(min) => set({ min })}
          keyboardType="decimal-pad"
          right={<TextInput.Affix text="€" />}
          style={{ flex: 1 }}
        />
        <TextInput
          mode="outlined"
          label="Up to (optional)"
          value={draft.max}
          onChangeText={(max) => set({ max })}
          keyboardType="decimal-pad"
          right={<TextInput.Affix text="€" />}
          style={{ flex: 1 }}
        />
      </View>
      <Text variant="bodySmall" style={{ marginTop: 12, marginBottom: 6 }}>…use this category</Text>
      <CategoryPicker value={draft.category} onChange={(category) => set({ category })} />
      <HelperText type="error" visible={!!error}>
        {error}
      </HelperText>
      <View style={{ marginTop: 12, gap: 8 }}>
        <Button label="Save rule" icon="content-save-outline" onPress={onSave} disabled={busy} />
        <Button label="Cancel" mode="text" onPress={onCancel} disabled={busy} />
      </View>
    </Card>
  );
}
