import { Badge, Banner, Button, Card, Row, Box, Screen, Section, Stack, Text, TopBar } from "@financer/ui";

import { ago } from "../../logic/format";
import { useNav } from "../nav";
import { useMail } from "../runtime";

const SETTINGS = [
  ["FINANCER_MAIL_IMAP_HOST", "imap.example.org"],
  ["FINANCER_MAIL_USERNAME", "you@example.org"],
  ["FINANCER_MAIL_PASSWORD", "an app password"],
];

/** Whether the server reads and sends mail, how the last check went, and how to connect a mailbox. */
export function MailboxScreen() {
  const { info, syncing, syncNow, now, error } = useMail();
  const nav = useNav();
  const last = info?.last_sync;
  return (
    <Screen maxW="normal" header={<TopBar title="Mailbox" onBack={nav.exit} />}>
      {error ? <Banner tone="danger">{error}</Banner> : null}
      {info?.configured ? (
        <Section title="Connected" card>
          <Stack gap="md">
            <Row justify="between" gap="md">
              <Text variant="body">{info.address?.email}</Text>
              <Badge label={`${info.messages} messages`} tone="neutral" />
            </Row>
            <Text variant="caption" tone="muted">
              {last ? `Checked ${ago(last.at, now())}: ${last.stored} new, ${last.events} calendar ${last.events === 1 ? "entry" : "entries"}.` : "Not checked yet."}
              {info.poll_minutes > 0 ? ` The server checks every ${info.poll_minutes} minutes.` : " The server checks only when asked."}
            </Text>
            {last?.error ? <Banner tone="warning" title="The last check failed">{last.error}</Banner> : null}
            {last?.more ? <Text variant="caption" tone="muted">There is more to download; the next check continues.</Text> : null}
            <Button label="Check now" icon="sync" loading={syncing} onPress={() => void syncNow()} />
            <Text variant="caption" tone="subtle">Mail is only read. Nothing is marked as read, moved or deleted on the mail server.</Text>
          </Stack>
        </Section>
      ) : (
        <Section title="Connect a mailbox" description="The server reads and sends the mail, so set it up there. The password is read from the server's environment and never stored." card>
          <Stack gap="md">
            {SETTINGS.map(([name, example]) => (
              <Card key={name} variant="flat" gap="2xs">
                <Text variant="label">{name}</Text>
                <Text variant="caption" tone="muted">{example}</Text>
              </Card>
            ))}
            <Box>
              <Text variant="caption" tone="subtle">Then restart the server. The server needs the mail feature (docs/MAIL.md). Gmail, iCloud and Outlook need an app password.</Text>
            </Box>
          </Stack>
        </Section>
      )}
    </Screen>
  );
}
