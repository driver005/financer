import { useRouter } from "expo-router";
import { Badge, Box, Button, Card, Chip, ChipRow, Note, Row, Spinner, Text } from "@financer/ui";

import type { BankConnection } from "@/api/client";
import { connectionKey, connectionSubtitle, isBusy, lastResultText, linkedAccountsText, needsLinking, stateLabel, stateTone } from "@/bankConnections";
import { SOURCES, connectionsOf, needsSetup, panelActionLabel, sourceInfo, sourceStatus, type SourceId } from "@/bankSetup";
import { toTone } from "@/uiTone";

/**
 * Where the transactions come from, one tap away: a row of chips (CSV import, Sparkasse, GoCardless,
 * Plaid, finAPI) and a panel for the chosen one with its state and its main action. With nothing
 * set up it shows the "Set up" button that opens the menu of everything that can be connected.
 */
export function SourceSwitcher({
  list,
  active,
  onChange,
  onSetup,
  onImportCsv,
  importing,
  starting,
  errors,
  onStart,
  onCancel,
  onOpenLink,
}: {
  list: BankConnection[];
  active: SourceId;
  onChange: (id: SourceId) => void;
  /** Opens the setup menu, at the given source when there is one. */
  onSetup: (id?: SourceId) => void;
  onImportCsv: () => void;
  importing: boolean;
  starting: string | null;
  errors: Record<string, string>;
  onStart: (conn: BankConnection) => void;
  onCancel: (conn: BankConnection) => void;
  onOpenLink: (conn: BankConnection) => void;
}) {
  const router = useRouter();
  const info = sourceInfo(active);
  const mine = connectionsOf(list, active);
  return (
    <Box gap="sm">
      <ChipRow>
        {SOURCES.map((s) => (
          <Chip key={s.id} label={s.label} icon={s.icon} selected={active === s.id} onPress={() => onChange(s.id)} />
        ))}
      </ChipRow>
      <Card variant="outline" gap="md">
        <Row justify="between" gap="sm">
          <Box grow>
            <Text variant="bodyStrong">{info.label}</Text>
            <Text variant="caption" tone="muted">{info.blurb}</Text>
          </Box>
          <Badge label={sourceStatus(list, active)} tone={toTone(mine.length > 0 && mine.every((c) => c.linked) ? "good" : "muted")} />
        </Row>

        {active === "csv" ? (
          <Button label="Import a CSV file" icon="file-delimited-outline" onPress={onImportCsv} disabled={importing} />
        ) : active === "fints" ? (
          <Button label="Sync with Sparkasse" icon="bank-transfer" onPress={() => router.push("/sync")} />
        ) : null}

        {active !== "csv" && mine.length === 0 ? (
          <>
            <Text variant="caption" tone="muted">{`Needs: ${info.needs}`}</Text>
            {active !== "fints" ? <Button label={`Set up ${info.label}`} icon="plus" variant="outline" onPress={() => onSetup(active)} /> : null}
          </>
        ) : null}

        {active !== "csv" && active !== "fints"
          ? mine.map((conn) => {
              const key = connectionKey(conn);
              const accounts = linkedAccountsText(conn);
              const last = lastResultText(conn);
              return (
                <Box key={key} gap="sm">
                  <Row justify="between" gap="sm">
                    <Box grow>
                      <Text variant="bodyStrong">{conn.name}</Text>
                      <Text variant="caption" tone="muted">{connectionSubtitle(conn)}</Text>
                    </Box>
                    <Badge label={stateLabel(conn)} tone={toTone(stateTone(conn))} />
                  </Row>
                  {conn.state === "needs_link" ? (
                    <Box gap="sm" accessibilityRole="alert">
                      <Row gap="md">
                        <Spinner />
                        <Box grow><Text variant="body">Sign in to your bank on the page that opened. This screen updates when you are done.</Text></Box>
                      </Row>
                      <Button label="Open the sign-in page" icon="open-in-new" variant="outline" onPress={() => onOpenLink(conn)} />
                      <Button label="Cancel" variant="ghost" onPress={() => onCancel(conn)} />
                    </Box>
                  ) : null}
                  {conn.state === "syncing" ? (
                    <Row gap="md">
                      <Spinner />
                      <Box grow><Text variant="body">Reading transactions…</Text></Box>
                    </Row>
                  ) : null}
                  {conn.state === "error" && conn.message ? <Note tone="error">{conn.message}</Note> : null}
                  {errors[key] ? <Note tone="error">{errors[key]}</Note> : null}
                  {accounts ? <Text variant="caption" tone="muted">{`Accounts: ${accounts}`}</Text> : null}
                  {last ? <Text variant="caption" tone="muted">{last}</Text> : null}
                  {!isBusy(conn) ? (
                    <Button
                      label={panelActionLabel(conn, starting === key)}
                      icon={needsLinking(conn) ? "link-variant" : "sync"}
                      onPress={() => onStart(conn)}
                      disabled={starting !== null}
                    />
                  ) : null}
                </Box>
              );
            })
          : null}

        {needsSetup(list) && active === "csv" ? (
          <Button label="Set up a bank connection" icon="bank-plus" variant="outline" onPress={() => onSetup()} />
        ) : null}
      </Card>
    </Box>
  );
}
