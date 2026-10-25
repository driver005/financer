import { useEffect, useState } from "react";

import type { Settings } from "@/api/client";
import { TextInput } from "@/components/kit";
import { PaydayPicker } from "@/components/PaydayPicker";
import { FieldMessage, PanelText, Segmented, SettingsPanel } from "@/components/settings/SettingsKit";
import { aiSummary, habitLabel, paydayLabel } from "@/settingsPlan";

/** Saves a change to the server settings; resolves with an error message, or null when it worked. */
export type SaveSetting = (patch: { payday?: number; habit_mode?: string; llm_provider?: string; llm_model?: string }) => Promise<string | null>;

/** Settings, Money: the day the budget month starts. */
export function PaydayCard({ settings, onSave }: { settings: Settings; onSave: SaveSetting }) {
  const [error, setError] = useState<string | null>(null);
  return (
    <SettingsPanel icon="calendar-month-outline" title="Budget period" summary={`Payday: ${paydayLabel(settings.payday)}`}>
      <PanelText style={{ marginTop: 4 }}>
        Your budget month runs from payday to the day before the next one, so limits and the daily number line up with your salary. Day 1 is the calendar month.
      </PanelText>
      <PaydayPicker value={settings.payday} onChange={(day) => void onSave({ payday: day }).then(setError)} />
      {error ? <FieldMessage tone="error">{error}</FieldMessage> : null}
    </SettingsPanel>
  );
}

/** Settings, Groceries: how the app learns what you buy. */
export function HabitsCard({ settings, onSave }: { settings: Settings; onSave: SaveSetting }) {
  const [error, setError] = useState<string | null>(null);
  return (
    <SettingsPanel icon="basket-outline" title="How I learn what you buy" summary={habitLabel(settings.habit_mode)}>
      <Segmented
        style={{ marginTop: 8 }}
        value={settings.habit_mode}
        onValueChange={(v) => void onSave({ habit_mode: v }).then(setError)}
        buttons={[
          { value: "manual", label: "My list" },
          { value: "receipts", label: "Receipts" },
          { value: "spending", label: "Estimate" },
        ]}
      />
      <PanelText>Your bank only shows "REWE, 23,47 €", not what was in the bag. "Estimate" uses a generic basket.</PanelText>
      {error ? <FieldMessage tone="error">{error}</FieldMessage> : null}
    </SettingsPanel>
  );
}

/** Settings, Groceries: which AI writes recipe ideas, and a read-only look at whether the server has a key. */
export function AiCard({ settings, onSave }: { settings: Settings; onSave: SaveSetting }) {
  const [model, setModel] = useState(settings.llm_model);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setModel(settings.llm_model), [settings.llm_model]);
  const keyConfigured = settings.llm_provider === "claude" ? settings.claude_key_configured : settings.openai_key_configured;
  return (
    <SettingsPanel icon="creation-outline" title="Recipe ideas by AI" summary={aiSummary(settings.llm_provider, keyConfigured, settings.llm_model)}>
      <Segmented
        style={{ marginTop: 8 }}
        value={settings.llm_provider}
        onValueChange={(v) => void onSave({ llm_provider: v }).then(setError)}
        buttons={[
          { value: "claude", label: "Claude" },
          { value: "open_ai", label: "OpenAI" },
        ]}
      />
      <TextInput
        mode="outlined"
        label="Model (empty = default)"
        accessibilityLabel="Model (empty = default)"
        value={model}
        onChangeText={setModel}
        onEndEditing={() => model !== settings.llm_model && void onSave({ llm_model: model }).then(setError)}
        autoCapitalize="none"
        autoCorrect={false}
        style={{ marginTop: 12 }}
      />
      <FieldMessage tone={keyConfigured ? "ok" : "error"}>
        {keyConfigured
          ? "An API key is configured on the server."
          : settings.llm_provider === "claude"
            ? "No key yet: add it under Server settings > AI (or set FINANCER_ANTHROPIC_API_KEY on the server)."
            : "No key yet: add it under Server settings > AI (or set FINANCER_OPENAI_API_KEY on the server)."}
      </FieldMessage>
      {error ? <FieldMessage tone="error">{error}</FieldMessage> : null}
      <PanelText>Only item names, offers, diet and budget are sent, never bank data.</PanelText>
    </SettingsPanel>
  );
}
