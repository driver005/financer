import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Text as RNText, View } from "react-native";

import type { Rule } from "@/api/client";
import { useApi } from "@/api/config";
import { CategoryPicker } from "@/components/CategoryPicker";
import { TextInput } from "@/components/kit";
import {
  DangerButton,
  EmptyState,
  FieldMessage,
  IconAction,
  Segmented,
  SectionHeader,
  SettingsGroup,
} from "@/components/settings/SettingsKit";
import { Button, Card, Loading, NeedsSetup, Screen, Title } from "@/components/ui";
import { ChunkyButton, Text } from "@/components/kit";
import { useScreenData } from "@/hooks";
import { usePalette } from "@/theme";
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
  const p = usePalette();
  const { data: rules, error, reload } = useScreenData((a) => a.rules());
  const [draft, setDraft] = useState<RuleDraft | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // the rule whose delete is waiting for a second tap
  const [deleting, setDeleting] = useState<number | null>(null);

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
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <ScrollView keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets contentContainerStyle={{ paddingBottom: 32 }}>
            <Text variant="bodyMedium" style={{ color: p.muted }}>
              Rules run from top to bottom; the first match wins and beats the built-in categories. They apply to new imports and syncs. Transactions you categorized by hand are never changed by rules.
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
              <View style={{ gap: 8, marginTop: 16 }}>
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

            {message || error ? <FieldMessage tone={message ? (message.ok ? "ok" : "error") : "error"}>{message?.text ?? error}</FieldMessage> : null}

            {rules === null ? (
              <Loading />
            ) : rules.length === 0 ? (
              draft ? null : (
                <EmptyState
                  mood="happy"
                  title="No rules yet"
                  body={'A rule teaches me where a merchant belongs, for example everything from "rewe" is groceries. Add one above, or change a transaction\'s category and switch on "Remember for this merchant".'}
                />
              )
            ) : (
              <>
                <SectionHeader title={`Your rules (${rules.length})`} />
                <SettingsGroup>
                  {rules.map((r, i) => (
                    <View
                      key={r.id}
                      style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4, borderBottomWidth: 1, borderBottomColor: p.border }}
                    >
                      <View style={{ flexDirection: "row", gap: 12, alignItems: "flex-start" }}>
                        <View
                          accessibilityElementsHidden
                          importantForAccessibility="no-hide-descendants"
                          style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: p.surfaceAlt, alignItems: "center", justifyContent: "center" }}
                        >
                          <RNText style={{ color: p.accent, fontWeight: "800", fontSize: 14 }}>{i + 1}</RNText>
                        </View>
                        <RNText style={{ flex: 1, color: p.text, fontSize: 16, fontWeight: "700" }} accessibilityLabel={`Rule ${i + 1}: ${describeRule(fields(r))}`}>
                          {describeRule(fields(r))}
                        </RNText>
                      </View>
                      {deleting === r.id ? (
                        <View accessibilityRole="alert" style={{ marginTop: 8, marginBottom: 8, gap: 4 }}>
                          <RNText style={{ color: p.muted, fontSize: 14 }}>Delete this rule? Transactions it already categorized keep their category.</RNText>
                          <DangerButton
                            solid
                            label="Yes, delete"
                            icon="trash-can-outline"
                            onPress={() => {
                              setDeleting(null);
                              void run(async () => void (await api.deleteRule(r.id)));
                            }}
                          />
                          <ChunkyButton flat label="Cancel" onPress={() => setDeleting(null)} />
                        </View>
                      ) : (
                        <View style={{ flexDirection: "row", justifyContent: "flex-end" }}>
                          <IconAction icon="arrow-up" label="Move up (higher priority)" disabled={busy || i === 0} onPress={() => run(async () => void (await api.reorderRules(moveId(ids, i, -1))))} />
                          <IconAction icon="arrow-down" label="Move down (lower priority)" disabled={busy || i === rules.length - 1} onPress={() => run(async () => void (await api.reorderRules(moveId(ids, i, 1))))} />
                          <IconAction icon="pencil-outline" label="Edit rule" onPress={() => startEdit(r)} />
                          <IconAction icon="trash-can-outline" label="Delete rule" tone="danger" onPress={() => setDeleting(r.id)} />
                        </View>
                      )}
                    </View>
                  ))}
                </SettingsGroup>
              </>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
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
  const p = usePalette();
  const set = (patch: Partial<RuleDraft>) => onChange({ ...draft, ...patch });
  const label = { color: p.muted, fontSize: 12, fontWeight: "800" as const, letterSpacing: 1, textTransform: "uppercase" as const, marginTop: 16, marginBottom: 8 };
  return (
    <Card style={{ marginTop: 16 }}>
      <Text variant="titleMedium" accessibilityRole="header">{isEdit ? "Edit rule" : "New rule"}</Text>
      <RNText style={label}>If the merchant name…</RNText>
      <Segmented<MatchKind>
        value={draft.kind}
        onValueChange={(kind) => set({ kind })}
        buttons={[
          { value: "contains", label: "Contains" },
          { value: "equals", label: "Is" },
          { value: "starts_with", label: "Starts" },
        ]}
      />
      <View style={{ marginTop: 8 }}>
        <TextInput
          mode="outlined"
          label="Name"
          value={draft.pattern}
          onChangeText={(pattern) => set({ pattern })}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="e.g. kiosk"
        />
      </View>
      <RNText style={label}>Only for…</RNText>
      <Segmented<RuleDraft["sign"]>
        value={draft.sign}
        onValueChange={(sign) => set({ sign })}
        buttons={[
          { value: "any", label: "Any" },
          { value: "expense", label: "Expenses" },
          { value: "income", label: "Income" },
        ]}
      />
      <View style={{ flexDirection: "row", gap: 12, marginTop: 12 }}>
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
      <RNText style={label}>…use this category</RNText>
      <CategoryPicker value={draft.category} onChange={(category) => set({ category })} />
      {error ? <FieldMessage tone="error">{error}</FieldMessage> : null}
      <View style={{ marginTop: 16, gap: 4 }}>
        <Button label="Save rule" icon="content-save-outline" onPress={onSave} disabled={busy} />
        <Button label="Cancel" mode="text" onPress={onCancel} disabled={busy} />
      </View>
    </Card>
  );
}
