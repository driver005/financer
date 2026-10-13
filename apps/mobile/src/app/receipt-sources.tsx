import { useCallback, useState } from "react";
import { RefreshControl, ScrollView, Text as RNText, View } from "react-native";

import type { Api, LidlStatus, ReceiptSource } from "@/api/client";
import { useApi } from "@/api/config";
import { EmptyState } from "@/components/EmptyState";
import { LidlCard } from "@/components/receipts/LidlCard";
import { IconBadge, ListGroup, ListRow, StatusPill } from "@/components/rows";
import { SkeletonList } from "@/components/Skeleton";
import { FieldMessage, PanelText, SettingsPanel } from "@/components/settings/SettingsKit";
import { ChunkyButton } from "@/components/kit";
import { Card, Loading, NeedsSetup, Screen, Title } from "@/components/ui";
import { useScreenData } from "@/hooks";
import {
  attentionCount,
  canSyncNow,
  healthPill,
  importedText,
  lastSyncText,
  nextRunText,
  noSourceText,
  setupSteps,
  sourceBlurb,
  sourceIcon,
  sourceTitle,
  summaryText,
  syncResultText,
} from "@/receiptSources";
import { space, typography, usePalette } from "@/theme";

type Loaded = { sources: ReceiptSource[]; lidl: LidlStatus | null };

async function loadAll(api: Api): Promise<Loaded> {
  const [sources, lidl] = await Promise.all([api.receiptSources(), api.lidlStatus().catch(() => null)]);
  return { sources, lidl };
}

/**
 * Receipt sources: where receipts come from without you typing or photographing them. One card per
 * source with its state, last sync, how many receipts it brought, the last problem, a Sync now
 * button and help for setting it up.
 */
export default function ReceiptSources() {
  const { api, loaded, mode: backendMode } = useApi();
  const onPhone = backendMode === "embedded";
  const p = usePalette();
  const { data, error, busy, reload } = useScreenData(loadAll);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "error" | "ok" | "info"; text: string } | null>(null);

  const sync = useCallback(
    async (source?: string) => {
      if (!api) return;
      setSyncing(source ?? "all");
      setMessage(null);
      try {
        const r = await api.syncReceipts(source);
        setMessage({ tone: "info", text: syncResultText(r.imported, r.linked) });
        await reload();
      } catch (e) {
        setMessage({ tone: "error", text: e instanceof Error ? e.message : "Sync failed" });
      } finally {
        setSyncing(null);
      }
    },
    [api, reload],
  );

  if (!loaded) return <Screen><Loading /></Screen>;

  const list = data?.sources ?? [];
  const now = Math.floor(Date.now() / 1000);
  const allOff = data !== null && list.every((s) => !s.enabled);
  const attention = attentionCount(list);
  const anySyncable = list.some(canSyncNow);

  return (
    <Screen>
      <Title subtitle={data ? summaryText(list) : undefined}>Receipt sources</Title>
      {!api ? (
        <NeedsSetup />
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingBottom: space.xxl }}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={busy} onRefresh={reload} />}
        >
          {error && !data ? (
            <EmptyState title="Could not load the sources" message={error} actionLabel="Try again" actionIcon="refresh" onAction={() => void reload()} mood="worried" />
          ) : null}
          {!data && !error ? <SkeletonList rows={3} label="Loading receipt sources" /> : null}

          {data ? (
            <>
              {allOff ? (
                <EmptyState
                  title="No source is switched on"
                  message={noSourceText(onPhone)}
                  mood="happy"
                />
              ) : null}

              {attention > 0 ? (
                <Card>
                  <FieldMessage tone="error">
                    {attention === 1 ? "One source needs your attention." : `${attention} sources need your attention.`}
                  </FieldMessage>
                </Card>
              ) : null}

              {anySyncable ? (
                <View style={{ marginBottom: space.md }}>
                  <ChunkyButton
                    label={syncing === "all" ? "Syncing…" : "Sync all now"}
                    icon="sync"
                    onPress={() => void sync()}
                    disabled={syncing !== null}
                  />
                </View>
              ) : null}
              {message ? <FieldMessage tone={message.tone}>{message.text}</FieldMessage> : null}

              {list.map((s) =>
                s.source === "lidl_plus" ? (
                  <View key={s.source} style={{ marginTop: space.md }}>
                    <LidlCard api={api} source={s} status={data.lidl} onChanged={reload} />
                  </View>
                ) : (
                  <SourceCard key={s.source} s={s} now={now} onPhone={onPhone} syncing={syncing === s.source} disabled={syncing !== null} onSync={() => void sync(s.source)} />
                ),
              )}

              <RNText style={[typography.caption, { color: p.muted, marginTop: space.sm, paddingHorizontal: space.xs }]}>
                New receipts are matched to your bank payments when the shop, the amount (within a cent) and the date (within three days) fit and nothing else does. Passwords are never stored in the app or the config file.
              </RNText>
            </>
          ) : null}
        </ScrollView>
      )}
    </Screen>
  );
}

/** Mailbox and folder: status, numbers, last problem, Sync now and setup help. */
function SourceCard({ s, now, onPhone, syncing, disabled, onSync }: { s: ReceiptSource; now: number; onPhone: boolean; syncing: boolean; disabled: boolean; onSync: () => void }) {
  const pill = healthPill(s);
  const next = nextRunText(s.next_run, now);
  return (
    <ListGroup style={{ marginTop: space.md }}>
      <ListRow
        leading={<IconBadge icon={sourceIcon(s.source)} tone={s.enabled ? "accent" : "muted"} />}
        title={sourceTitle(s.source)}
        subtitle={s.detail ?? sourceBlurb(s.source)}
        value={<StatusPill label={pill.label} tone={pill.tone} icon={pill.icon} />}
        chevron={false}
        accessibilityLabel={`${sourceTitle(s.source)}, ${pill.label}`}
      />
      {s.enabled ? (
        <ListRow title="Last sync" subtitle={next ?? undefined} value={lastSyncText(s.last_run, now)} chevron={false} />
      ) : null}
      {s.enabled ? <ListRow title="Receipts" subtitle={s.last_imported > 0 ? `${s.last_imported} new in the last run` : undefined} value={importedText(s.imported_total)} chevron={false} /> : null}
      {s.last_error ? (
        <ListRow icon="alert-circle-outline" iconTone="bad" title="Last problem" subtitle={s.last_error} subtitleLines={6} chevron={false} />
      ) : null}
      {s.notes.length > 0 ? (
        <ListRow icon="information-outline" iconTone="muted" title="Skipped in the last run" subtitle={s.notes.join("\n")} subtitleLines={8} chevron={false} />
      ) : null}
      {canSyncNow(s) ? (
        <View style={{ padding: space.lg }}>
          <ChunkyButton label={syncing ? "Syncing…" : `Sync ${sourceTitle(s.source).toLowerCase()} now`} icon="sync" outline onPress={onSync} disabled={disabled} />
        </View>
      ) : null}
      <SettingsPanel icon="help-circle-outline" title={s.enabled ? "Setup help" : "How to switch it on"}>
        {setupSteps(s.source, onPhone).map((step, i) => (
          <PanelText key={i}>{`${i + 1}. ${step}`}</PanelText>
        ))}
      </SettingsPanel>
    </ListGroup>
  );
}
