import { useCallback, useState } from "react";
import { Badge, Box, Button, Card, Expandable, Group, ListItem, Note, Section, Text, VirtualList } from "@financer/ui";

import type { Api, LidlStatus, ReceiptSource } from "@/api/client";
import { useApi } from "@/api/config";
import { Page } from "@/components/Page";
import { SignInCard } from "@/components/receipts/SignInCard";
import { Empty, Loading, NeedsSetup } from "@/components/Status";
import { useScreenData } from "@/hooks";
import {
  attentionCount,
  canSyncNow,
  healthPill,
  importedText,
  lastSyncText,
  nextRunText,
  noSourceText,
  SHOP_GUIDES,
  setupSteps,
  sourceBlurb,
  sourceIcon,
  sourceTitle,
  summaryText,
  syncResultText,
} from "@/receiptSources";
import { asIcon, toTone } from "@/uiTone";

type Loaded = { sources: ReceiptSource[]; lidl: LidlStatus | null; kaufland: LidlStatus | null };

async function loadAll(api: Api): Promise<Loaded> {
  const [sources, lidl, kaufland] = await Promise.all([api.receiptSources(), api.lidlStatus().catch(() => null), api.kauflandStatus().catch(() => null)]);
  return { sources, lidl, kaufland };
}

/**
 * Receipt sources: where receipts come from without you typing or photographing them. One card per
 * source with its state, last sync, how many receipts it brought, the last problem, a Sync now
 * button and help for setting it up.
 */
export default function ReceiptSources() {
  const { api, loaded, mode: backendMode } = useApi();
  const onPhone = backendMode === "embedded";
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

  if (!loaded) return <Page title="Receipt sources"><Loading /></Page>;
  if (!api) return <Page title="Receipt sources"><NeedsSetup /></Page>;

  const list = data?.sources ?? [];
  const now = Math.floor(Date.now() / 1000);
  const allOff = data !== null && list.every((s) => !s.enabled);
  const attention = attentionCount(list);
  const anySyncable = list.some(canSyncNow);

  return (
    <Page title="Receipt sources" subtitle={data ? summaryText(list) : undefined} fixed>
      <VirtualList
        data={list}
        keyExtractor={(s) => s.source}
        refreshing={busy}
        onRefresh={reload}
        gap="lg"
        header={
          <Box gap="md">
            {error && !data ? <Empty title="Could not load the sources" message={error} actionLabel="Try again" actionIcon="refresh" onAction={() => void reload()} mood="worried" /> : null}
            {!data && !error ? <Loading rows={3} /> : null}
            {data && allOff ? <Empty title="No source is switched on" message={noSourceText(onPhone)} mood="happy" /> : null}
            {attention > 0 ? <Note tone="error">{attention === 1 ? "One source needs your attention." : `${attention} sources need your attention.`}</Note> : null}
            {anySyncable ? <Button label={syncing === "all" ? "Syncing…" : "Sync all now"} icon="sync" onPress={() => void sync()} disabled={syncing !== null} /> : null}
            {message ? <Note tone={message.tone}>{message.text}</Note> : null}
          </Box>
        }
        footer={
          data ? (
            <Box gap="lg">
              <Section title="REWE, Kaufland, Penny, ALDI" description="None of these shops has a public interface for receipts. This is what works for each.">
                <Card gap="sm">
                  {SHOP_GUIDES.map((g) => (
                    <Expandable key={g.shop} icon="storefront-outline" title={g.shop} summary={g.summary}>
                      {g.steps.map((step, i) => (
                        <Text key={i} variant="caption" tone="muted">{`${i + 1}. ${step}`}</Text>
                      ))}
                    </Expandable>
                  ))}
                </Card>
              </Section>
            <Text variant="caption" tone="muted">
              New receipts are matched to your bank payments when the shop, the amount (within a cent) and the date (within three days) fit and nothing else does. Passwords are never stored in the app or the config file.
            </Text>
            </Box>
          ) : null
        }
        renderItem={(s) =>
          (s.source === "lidl_plus" || s.source === "kaufland_card") && data ? (
            <SignInCard brand={s.source} api={api} source={s} status={s.source === "lidl_plus" ? data.lidl : data.kaufland} onChanged={reload} />
          ) : (
            <SourceCard s={s} now={now} onPhone={onPhone} syncing={syncing === s.source} disabled={syncing !== null} onSync={() => void sync(s.source)} />
          )
        }
      />
    </Page>
  );
}

/** Mailbox and folder: status, numbers, last problem, Sync now and setup help. */
function SourceCard({ s, now, onPhone, syncing, disabled, onSync }: { s: ReceiptSource; now: number; onPhone: boolean; syncing: boolean; disabled: boolean; onSync: () => void }) {
  const pill = healthPill(s);
  const next = nextRunText(s.next_run, now);
  return (
    <Card gap="md">
      <Group>
        <ListItem
          icon={asIcon(sourceIcon(s.source))}
          title={sourceTitle(s.source)}
          subtitle={s.detail ?? sourceBlurb(s.source)}
          trailing={<Badge label={pill.label} tone={toTone(pill.tone)} icon={asIcon(pill.icon)} />}
          label={`${sourceTitle(s.source)}, ${pill.label}`}
        />
        {s.enabled ? <ListItem title="Last sync" subtitle={next ?? undefined} value={lastSyncText(s.last_run, now)} /> : null}
        {s.enabled ? <ListItem title="Receipts" subtitle={s.last_imported > 0 ? `${s.last_imported} new in the last run` : undefined} value={importedText(s.imported_total)} /> : null}
        {s.last_error ? <ListItem icon="alert-circle-outline" tone="danger" title="Last problem" subtitle={s.last_error} /> : null}
        {s.notes.length > 0 ? <ListItem icon="information-outline" title="Skipped in the last run" subtitle={s.notes.join("\n")} /> : null}
      </Group>
      {canSyncNow(s) ? <Button label={syncing ? "Syncing…" : `Sync ${sourceTitle(s.source).toLowerCase()} now`} icon="sync" variant="outline" onPress={onSync} disabled={disabled} /> : null}
      <Expandable icon="help-circle-outline" title={s.enabled ? "Setup help" : "How to switch it on"}>
        {setupSteps(s.source, onPhone).map((step, i) => (
          <Text key={i} variant="caption" tone="muted">{`${i + 1}. ${step}`}</Text>
        ))}
      </Expandable>
    </Card>
  );
}
