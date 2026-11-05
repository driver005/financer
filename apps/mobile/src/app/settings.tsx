import { useRouter } from "expo-router";
import { useCallback } from "react";
import { Group, ListItem, Note, Section, Text } from "@financer/ui";

import { useApi } from "@/api/config";
import { AboutCard } from "@/components/AboutCard";
import { BackupCard } from "@/components/BackupCard";
import { BankConnectionsCard } from "@/components/BankConnectionsCard";
import { LockCard } from "@/components/LockCard";
import { NotificationsCard } from "@/components/NotificationsCard";
import { Page } from "@/components/Page";
import { BackendCard } from "@/components/settings/BackendCard";
import { DataCard } from "@/components/settings/DataCard";
import { AiCard, HabitsCard, PaydayCard, type SaveSetting } from "@/components/settings/PreferenceCards";
import { useScreenData } from "@/hooks";
import { startReplay } from "@/native/onboardingStore";
import { SHOPPING_ENABLED } from "@/modules";
import { priceSourcesLabel } from "@/settingsPlan";

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

  return (
    <Page title="Settings">
      <Section quiet title="Account & data">
        <Group>
          <BackendCard settingsLoaded={settings !== null} settingsError={error} />
          {api && mode === "remote" ? <ListItem icon="server-network" tile title="Server settings" subtitle="Keys, bank providers, receipts: everything in financer.toml" onPress={() => router.push("/server-config")} /> : null}
          <DataCard />
          <BackupCard />
        </Group>
        {api ? null : <Text variant="caption" tone="muted">Export, import and backup appear once a backend is connected.</Text>}
        {api && error ? <Note tone="error">{`Could not load your settings: ${error}`}</Note> : null}
      </Section>

      <Section quiet title="Money">
        <Group>
          {settings ? <PaydayCard settings={settings} onSave={save} /> : null}
          <ListItem icon="shape-outline" tile title="Categorization rules" subtitle="Match merchants to categories" onPress={() => router.push("/rules")} />
          <ListItem icon="calendar-sync-outline" tile title="Subscriptions" subtitle="Recurring payments and price increases" onPress={() => router.push("/subscriptions")} />
          <ListItem icon="shield-alert-outline" tile title="Alerts" subtitle="Payments that look odd" onPress={() => router.push("/alerts")} />
          <ListItem icon="bank-transfer" tile title="Bank sync" subtitle="Sparkasse over FinTS" onPress={() => router.push("/sync")} />
          <BankConnectionsCard />
        </Group>
      </Section>

      <Section quiet title="Groceries">
        <Group>
          {settings ? <HabitsCard settings={settings} onSave={save} /> : null}
          <ListItem icon="format-list-checks" tile title="Usual items" subtitle="What you buy most often" onPress={() => router.push("/basket")} />
          <ListItem icon="receipt-text-outline" tile title="Receipts" subtitle="Add and read receipts" onPress={() => router.push("/receipts")} />
          <ListItem icon="email-sync-outline" tile title="Receipt sources" subtitle="Mailbox, Lidl Plus and a watched folder" onPress={() => router.push("/receipt-sources")} />
          <ListItem icon="silverware-fork-knife" tile title="Meal plan" subtitle="Plan the week and shop for it" onPress={() => router.push("/mealplan")} />
          {SHOPPING_ENABLED ? <ListItem icon="shopping-search-outline" tile title="Shopping assistant" subtitle="Compare phones, plans and prices" onPress={() => router.push("/shop")} /> : null}
          {settings ? <AiCard settings={settings} onSave={save} /> : null}
          {settings ? (
            <ListItem
              icon="tag-multiple-outline"
              tile
              title="Price sources"
              value={priceSourcesLabel(settings.price_sources)}
              subtitle={mode === "embedded" ? "Set in the on-phone settings" : "Add and change them under Server settings"}
              onPress={mode === "embedded" ? undefined : () => router.push("/server-config")}
            />
          ) : null}
        </Group>
      </Section>

      <Section quiet title="Privacy & security">
        <Group>
          <LockCard />
          <NotificationsCard />
        </Group>
        <Text variant="caption" tone="muted">Only item names, offers, diet and budget are ever sent to an AI model, never bank data.</Text>
      </Section>

      <Section quiet title="About">
        <Group>
          <AboutCard />
          <ListItem
            icon="replay"
            tile
            title="Replay setup"
            subtitle="Walk through the first-run questions again. Nothing is changed unless you answer."
            onPress={() => {
              void startReplay().then(() => router.push("/onboarding"));
            }}
          />
        </Group>
      </Section>
    </Page>
  );
}
