import { useCallback, useEffect, useState } from "react";

import { Badge, Banner, Box, Button, Card, EmptyState, Row, Screen, Section, Stack, Text, TopBar } from "@financer/ui";

import { MailApiError } from "../../api/client";
import type { Template, TemplateKind } from "../../api/types";
import { audienceText, exampleText, templatesOf } from "../../logic/templates";
import { useNav } from "../nav";
import { useMail } from "../runtime";

const KINDS: { kind: TemplateKind; title: string; description: string }[] = [
  { kind: "greeting", title: "Greetings", description: "Above your text, like “Lieber Max,”. Picked by who you write to." },
  { kind: "closing", title: "Closings", description: "Below your text, like “VG Paul”. Put on when the message is sent." },
];

/** The text that goes around a message, and for whom. */
export function TemplatesScreen() {
  const { client, version } = useMail();
  const nav = useNav();
  const [all, setAll] = useState<Template[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!client) return;
    try {
      setAll((await client.templates()).templates);
      setError(null);
    } catch (e) {
      setError(e instanceof MailApiError ? e.message : "Could not load the templates.");
    }
  }, [client]);
  useEffect(() => void load(), [load, version]);

  return (
    <Screen maxW="normal" header={<TopBar title="Templates" subtitle="Greeting and closing" onBack={nav.exit} />}>
      {error ? <Banner tone="danger" action={<Button label="Try again" variant="outline" tone="neutral" size="sm" onPress={() => void load()} />}>{error}</Banner> : null}
      {KINDS.map(({ kind, title, description }) => {
        const mine = all ? templatesOf(all, kind) : [];
        return (
          <Section key={kind} title={title} description={description} action={{ label: "Add", onPress: () => nav.push({ name: "template", kind }) }}>
            {all && mine.length === 0 ? (
              <EmptyState card icon="text-box-outline" title="None yet" message="Without one, nothing is added." action={<Button label={`Add a ${kind}`} variant="soft" onPress={() => nav.push({ name: "template", kind })} />} />
            ) : (
              <Stack gap="sm">
                {mine.map((t) => (
                  <Card key={t.id} variant="flat" onPress={() => nav.push({ name: "template", id: t.id })} label={`Edit ${t.name}`} gap="xs">
                    <Row justify="between" gap="sm">
                      <Box grow><Text variant="bodyStrong">{t.name}</Text></Box>
                      {t.is_default ? <Badge label="Default" tone="accent" /> : null}
                    </Row>
                    <Text variant="body">{exampleText(t.text)}</Text>
                    <Text variant="caption" tone="muted">For: {audienceText(t.audience)}</Text>
                  </Card>
                ))}
              </Stack>
            )}
          </Section>
        );
      })}
    </Screen>
  );
}
