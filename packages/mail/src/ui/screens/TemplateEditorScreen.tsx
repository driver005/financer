import { useEffect, useState } from "react";

import { Banner, Box, Button, Chip, ChipRow, Screen, Section, Stack, SwitchRow, Text, TextField, TopBar } from "@financer/ui";

import { MailApiError } from "../../api/client";
import type { Placeholder, Template, TemplateKind } from "../../api/types";
import { audienceText, BLANK_TEMPLATE, exampleText, parseAudience } from "../../logic/templates";
import { useNav } from "../nav";
import { useMail } from "../runtime";

/** Make or change one template, and see it filled in with an example person. */
export function TemplateEditorScreen({ id, kind }: { id?: number; kind?: TemplateKind }) {
  const { client, bump } = useMail();
  const nav = useNav();
  const [draft, setDraft] = useState<Omit<Template, "id"> | null>(id ? null : BLANK_TEMPLATE[kind ?? "greeting"]);
  const [audience, setAudience] = useState("");
  const [placeholders, setPlaceholders] = useState<Placeholder[]>([]);
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    client?.templates().then((r) => {
      if (!alive) return;
      setPlaceholders(r.placeholders);
      const found = id ? r.templates.find((t) => t.id === id) : undefined;
      if (found) {
        setDraft(found);
        setAudience(found.audience.join(", "));
      }
    }).catch(() => undefined);
    return () => { alive = false; };
  }, [client, id]);

  if (!draft) return <Screen header={<TopBar title="Template" onBack={nav.pop} />}><Text variant="body" tone="muted">Loading…</Text></Screen>;
  const set = <K extends keyof Omit<Template, "id">>(k: K, v: Omit<Template, "id">[K]) => setDraft({ ...draft, [k]: v });
  const greeting = draft.kind === "greeting";

  const save = async () => {
    if (!client) return;
    setBusy(true);
    setProblems([]);
    const body = { ...draft, audience: parseAudience(audience), fallback: draft.fallback?.trim() ? draft.fallback : null };
    try {
      if (id) await client.updateTemplate({ ...body, id });
      else await client.createTemplate(body);
      bump();
      nav.pop();
    } catch (e) {
      setProblems(e instanceof MailApiError ? (e.problems.length ? e.problems : [e.message]) : ["Could not save."]);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!client || !id) return;
    await client.deleteTemplate(id).catch(() => undefined);
    bump();
    nav.pop();
  };

  return (
    <Screen
      maxW="normal"
      header={<TopBar title={id ? "Edit template" : greeting ? "New greeting" : "New closing"} onBack={nav.pop} />}
      footer={
        <Box bg="surface" px={{ base: "lg", md: "xl" }} py="md" gap="sm">
          <Button label="Save" size="lg" full loading={busy} onPress={() => void save()} testID="template-save" />
          {id ? <Button label="Delete" variant="ghost" tone="danger" full onPress={() => void remove()} /> : null}
        </Box>
      }
    >
      {problems.length > 0 ? <Banner tone="danger" title="Check the template">{problems.join(" ")}</Banner> : null}
      <Section title="The text" card>
        <Stack gap="md">
          <TextField label="Name" value={draft.name} onChangeText={(v) => set("name", v)} placeholder={greeting ? "Friends" : "Short"} capitalize />
          <TextField label="Text" value={draft.text} onChangeText={(v) => set("text", v)} multiline helper="Several lines are fine." />
          <Stack gap="xs">
            <Text variant="caption" tone="muted">Tap to add</Text>
            <ChipRow>
              {placeholders.map((p) => <Chip key={p.name} label={`{${p.name}}`} onPress={() => set("text", `${draft.text}{${p.name}}`)} />)}
            </ChipRow>
          </Stack>
          <Box bg="sunken" radius="xl" p="md" gap="2xs">
            <Text variant="caption" tone="muted">Example</Text>
            <Text variant="body">{exampleText(draft.text) || " "}</Text>
          </Box>
          {greeting ? <TextField label="When the name is not known" value={draft.fallback ?? ""} onChangeText={(v) => set("fallback", v)} placeholder="Hallo," helper="Without it the greeting is left out for an address like info@firma.de." capitalize /> : null}
        </Stack>
      </Section>
      <Section title="Who it is for" description={`Now: ${audienceText(parseAudience(audience))}`} card>
        <Stack gap="md">
          <TextField label="Addresses and domains" value={audience} onChangeText={setAudience} placeholder="max@example.com, @firma.de" helper="Leave empty to use it for anyone. A match on an address wins over a domain." />
          <SwitchRow label="Use it when nothing fits better" description={`The default ${draft.kind}. Only one is the default.`} value={draft.is_default} onChange={(v) => set("is_default", v)} />
        </Stack>
      </Section>
    </Screen>
  );
}
