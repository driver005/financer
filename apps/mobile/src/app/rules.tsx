import { useState } from "react";
import { Box, Button, Card, Chip, ChipRow, ConfirmAction, IconButton, Note, Row, Section, Segmented, Text, TextField, VirtualList } from "@financer/ui";

import type { Rule } from "@/api/client";
import { useApi } from "@/api/config";
import { categoryLabel } from "@/categoryIcons";
import { Page } from "@/components/Page";
import { Empty, Loading, NeedsSetup } from "@/components/Status";
import { useScreenData } from "@/hooks";
import {
  CATEGORIES,
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

  if (!loaded) return <Page title="Rules"><Loading /></Page>;
  if (!api) return <Page title="Rules"><NeedsSetup /></Page>;

  const ids = (rules ?? []).map((r) => r.id);

  return (
    <Page title="Rules" fixed>
      <VirtualList
        data={rules ?? []}
        keyExtractor={(r) => String(r.id)}
        header={
          <Box gap="lg">
            <Text variant="label" tone="muted">
              Rules run from top to bottom; the first match wins and beats the built-in categories. They apply to new imports and syncs. Transactions you categorized by hand are never changed by rules.
            </Text>
            {draft ? (
              <RuleForm draft={draft} onChange={setDraft} onSave={save} onCancel={() => setDraft(null)} busy={busy} error={formError} isEdit={editing !== null} />
            ) : (
              <Box gap="sm">
                <Button label="Add a rule" icon="plus" onPress={startAdd} />
                <Button
                  label="Apply to existing transactions"
                  icon="refresh"
                  variant="outline"
                  disabled={busy}
                  onPress={() =>
                    run(async () => {
                      const r = await api.applyRules();
                      return r.changed === 0 ? "Nothing changed." : `${r.changed} transaction${r.changed === 1 ? "" : "s"} changed.`;
                    })
                  }
                />
              </Box>
            )}
            {message || error ? <Note tone={message ? (message.ok ? "ok" : "error") : "error"}>{message?.text ?? error}</Note> : null}
            {rules !== null && rules.length > 0 ? <Text variant="heading" level={2}>{`Your rules (${rules.length})`}</Text> : null}
          </Box>
        }
        empty={
          rules === null ? (
            <Loading />
          ) : draft ? null : (
            <Empty mood="happy" title="No rules yet" message={'A rule teaches me where a merchant belongs, for example everything from "rewe" is groceries. Add one above, or change a transaction\'s category and switch on "Remember for this merchant".'} />
          )
        }
        renderItem={(r, i) => (
          <Card gap="sm">
            <Row gap="md" align="start">
              <Box dim="avatar-sm" radius="xl" bg="sunken" align="center" justify="center" shrink={false}>
                <Text variant="label" tone="accent">{i + 1}</Text>
              </Box>
              <Box grow>
                <Text variant="bodyStrong" accessibilityLabel={`Rule ${i + 1}: ${describeRule(fields(r))}`}>{describeRule(fields(r))}</Text>
              </Box>
            </Row>
            <Row justify="end" gap="xs">
              <IconButton icon="arrow-up" label="Move up (higher priority)" disabled={busy || i === 0} onPress={() => run(async () => void (await api.reorderRules(moveId(ids, i, -1))))} />
              <IconButton icon="arrow-down" label="Move down (lower priority)" disabled={busy || i === (rules?.length ?? 1) - 1} onPress={() => run(async () => void (await api.reorderRules(moveId(ids, i, 1))))} />
              <IconButton icon="pencil-outline" label="Edit rule" onPress={() => startEdit(r)} />
            </Row>
            <ConfirmAction
              label="Delete rule"
              icon="trash-can-outline"
              question="Delete this rule?"
              consequence="Transactions it already categorized keep their category."
              confirmLabel="Yes, delete"
              disabled={busy}
              onConfirm={() => void run(async () => void (await api.deleteRule(r.id)))}
            />
          </Card>
        )}
      />
    </Page>
  );
}

function RuleForm({ draft, onChange, onSave, onCancel, busy, error, isEdit }: { draft: RuleDraft; onChange: (d: RuleDraft) => void; onSave: () => void; onCancel: () => void; busy: boolean; error: string | null; isEdit: boolean }) {
  const set = (patch: Partial<RuleDraft>) => onChange({ ...draft, ...patch });
  const euro = <Text variant="label" tone="muted">€</Text>;
  return (
    <Section title={isEdit ? "Edit rule" : "New rule"} card>
      <Text variant="label" tone="muted">If the merchant name…</Text>
      <Segmented<MatchKind>
        value={draft.kind}
        onChange={(kind) => set({ kind })}
        options={[
          { value: "contains", label: "Contains" },
          { value: "equals", label: "Is" },
          { value: "starts_with", label: "Starts" },
        ]}
      />
      <TextField label="Name" value={draft.pattern} onChangeText={(pattern) => set({ pattern })} placeholder="e.g. kiosk" />
      <Text variant="label" tone="muted">Only for…</Text>
      <Segmented<RuleDraft["sign"]>
        value={draft.sign}
        onChange={(sign) => set({ sign })}
        options={[
          { value: "any", label: "Any" },
          { value: "expense", label: "Expenses" },
          { value: "income", label: "Income" },
        ]}
      />
      <Row gap="md" align="start">
        <Box equal><TextField label="From (optional)" value={draft.min} onChangeText={(min) => set({ min })} keyboardType="decimal-pad" right={euro} /></Box>
        <Box equal><TextField label="Up to (optional)" value={draft.max} onChangeText={(max) => set({ max })} keyboardType="decimal-pad" right={euro} /></Box>
      </Row>
      <Text variant="label" tone="muted">…use this category</Text>
      <ChipRow>
        {CATEGORIES.map((c) => (
          <Chip key={c} label={categoryLabel(c)} selected={draft.category === c} onPress={() => set({ category: c })} />
        ))}
      </ChipRow>
      {error ? <Note tone="error">{error}</Note> : null}
      <Button label="Save rule" icon="content-save-outline" onPress={onSave} disabled={busy} />
      <Button label="Cancel" variant="ghost" onPress={onCancel} disabled={busy} />
    </Section>
  );
}
