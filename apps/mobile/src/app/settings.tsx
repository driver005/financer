import { useRouter } from "expo-router";
import { useCallback, type ReactNode } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, View } from "react-native";

import { useApi } from "@/api/config";
import { AboutCard } from "@/components/AboutCard";
import { BackupCard } from "@/components/BackupCard";
import { BankConnectionsCard } from "@/components/BankConnectionsCard";
import { LockCard } from "@/components/LockCard";
import { NotificationsCard } from "@/components/NotificationsCard";
import { BackendCard } from "@/components/settings/BackendCard";
import { DataCard } from "@/components/settings/DataCard";
import { AiCard, HabitsCard, PaydayCard, type SaveSetting } from "@/components/settings/PreferenceCards";
import {
  FieldMessage,
  SectionFootnote,
  SectionHeader,
  SettingsGroup,
  SettingsRow,
} from "@/components/settings/SettingsKit";
import { Screen, Title } from "@/components/ui";
import { useScreenData } from "@/hooks";
import { startReplay } from "@/native/onboardingStore";
import { SHOPPING_ENABLED } from "@/modules";
import { priceSourcesLabel, type SectionId } from "@/settingsPlan";

/**
 * Settings, in five sections (Account & data, Money, Groceries, Privacy & security, About). Each
 * section is a group of rows; a row either opens in place (a panel with its form), goes to a
 * screen, or shows a value read-only. Every card is its own component, so adding one (a bank
 * connections card, say) is one line in the section it belongs to.
 */
export default function SettingsScreen() {
  const { api, mode } = useApi();
  const router = useRouter();
  const { data: settings, setData: setSettings, error } = useScreenData((a) => a.settings());

  const save: SaveSetting = useCallback(
    async (patch) => {
      if (!api) return "Connect a backend first.";
      try {
        setSettings(await api.saveSettings(patch));
        return null;
      } catch (e) {
        return e instanceof Error ? e.message : "Could not save";
      }
    },
    [api, setSettings],
  );

  const section = (id: SectionId, title: string, body: ReactNode) => (
    <View key={id}>
      <SectionHeader title={title} />
      {body}
    </View>
  );

  return (
    <Screen>
      <Title>Settings</Title>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets contentContainerStyle={{ paddingBottom: 32 }}>
          {section(
            "data",
            "Account & data",
            <>
              <SettingsGroup>
                <BackendCard settingsLoaded={settings !== null} settingsError={error} />
                {api && mode === "remote" ? (
                  <SettingsRow
                    icon="server-network"
                    title="Server settings"
                    subtitle="Keys, bank providers, receipts: everything in financer.toml"
                    onPress={() => router.push("/server-config")}
                  />
                ) : null}
                <DataCard />
                <BackupCard />
              </SettingsGroup>
              {api ? null : <SectionFootnote>Export, import and backup appear once a backend is connected.</SectionFootnote>}
              {api && error ? <FieldMessage tone="error">Could not load your settings: {error}</FieldMessage> : null}
            </>,
          )}

          {section(
            "money",
            "Money",
            <>
              <SettingsGroup>
                {settings ? <PaydayCard settings={settings} onSave={save} /> : null}
                <SettingsRow icon="shape-outline" title="Categorization rules" subtitle="Match merchants to categories" onPress={() => router.push("/rules")} />
                <SettingsRow icon="calendar-sync-outline" title="Subscriptions" subtitle="Recurring payments and price increases" onPress={() => router.push("/subscriptions")} />
                <SettingsRow icon="shield-alert-outline" title="Alerts" subtitle="Payments that look odd" onPress={() => router.push("/alerts")} />
                <SettingsRow icon="bank-transfer" title="Bank sync" subtitle="Sparkasse over FinTS" onPress={() => router.push("/sync")} />
                <BankConnectionsCard />
              </SettingsGroup>
            </>,
          )}

          {section(
            "groceries",
            "Groceries",
            <SettingsGroup>
              {settings ? <HabitsCard settings={settings} onSave={save} /> : null}
              <SettingsRow icon="format-list-checks" title="Usual items" subtitle="What you buy most often" onPress={() => router.push("/basket")} />
              <SettingsRow icon="receipt-text-outline" title="Receipts" subtitle="Add and read receipts" onPress={() => router.push("/receipts")} />
              <SettingsRow icon="email-sync-outline" title="Receipt sources" subtitle="Mailbox, Lidl Plus and a watched folder" onPress={() => router.push("/receipt-sources")} />
              <SettingsRow icon="silverware-fork-knife" title="Meal plan" subtitle="Plan the week and shop for it" onPress={() => router.push("/mealplan")} />
              {SHOPPING_ENABLED ? (
                <SettingsRow icon="shopping-search-outline" title="Shopping assistant" subtitle="Compare phones, plans and prices" onPress={() => router.push("/shop")} />
              ) : null}
              {settings ? <AiCard settings={settings} onSave={save} /> : null}
              {settings ? (
                <SettingsRow
                  icon="tag-multiple-outline"
                  title="Price sources"
                  value={priceSourcesLabel(settings.price_sources)}
                  subtitle={mode === "embedded" ? "Set in the on-phone settings" : "Add and change them under Server settings"}
                  onPress={mode === "embedded" ? undefined : () => router.push("/server-config")}
                />
              ) : null}
            </SettingsGroup>,
          )}

          {section(
            "privacy",
            "Privacy & security",
            <>
              <SettingsGroup>
                <LockCard />
                <NotificationsCard />
              </SettingsGroup>
              <SectionFootnote>Only item names, offers, diet and budget are ever sent to an AI model, never bank data.</SectionFootnote>
            </>,
          )}

          {section(
            "about",
            "About",
            <SettingsGroup>
              <AboutCard />
              <SettingsRow
                icon="replay"
                title="Replay setup"
                subtitle="Walk through the first-run questions again. Nothing is changed unless you answer."
                onPress={() => {
                  void startReplay().then(() => router.push("/onboarding"));
                }}
              />
            </SettingsGroup>,
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
