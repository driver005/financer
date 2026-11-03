import { useEffect, useMemo, useRef, useState } from "react";

import { Banner, Box, Button, Chip, ChipRow, OptionList, Row, Sheet, Stack, Text, type Option } from "@financer/ui";

import type { MailClient } from "../../api/client";
import type { Choice, Preview, Template, TemplateKind } from "../../api/types";
import { choiceKey, choiceLabel, firstLine, templatesOf } from "../../logic/templates";

/** How long typing pauses before the message is dressed again. */
const PAUSE_MS = 400;

export type Dressing = {
  greeting: Choice;
  closing: Choice;
  setGreeting(c: Choice): void;
  setClosing(c: Choice): void;
  templates: Template[];
  /** The message as it would go, with greeting and closing on it. */
  preview: Preview | null;
};

/**
 * The greeting and closing that will be put around what is typed, worked out again a moment after
 * the text or the recipients change. This is the "at the end" step: the text stays as typed until it is sent.
 */
export function useDressing(client: MailClient | null, to: string[], body: string): Dressing {
  const [greeting, setGreeting] = useState<Choice>("auto");
  const [closing, setClosing] = useState<Choice>("auto");
  const [templates, setTemplates] = useState<Template[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const latest = useRef(0);

  useEffect(() => {
    let alive = true;
    client
      ?.templates()
      .then((r) => alive && setTemplates(r.templates))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [client]);

  const recipients = to.join("\n");
  useEffect(() => {
    if (!client || to.length === 0) {
      setPreview(null);
      return;
    }
    const mine = ++latest.current;
    const timer = setTimeout(() => {
      client
        .preview({ to, body: body.trim() ? body : "…", greeting, closing })
        .then((p) => mine === latest.current && setPreview(p))
        .catch(() => mine === latest.current && setPreview(null));
    }, PAUSE_MS);
    return () => clearTimeout(timer);
    // `to` is compared by its content
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, recipients, body, choiceKey(greeting), choiceKey(closing)]);

  return { greeting, closing, setGreeting, setClosing, templates, preview };
}

/** The two chips above the box you type in, and the sheet to change them and see the whole message. */
export function TemplateBar({ dressing, body }: { dressing: Dressing; body: string }) {
  const [open, setOpen] = useState(false);
  const { preview, greeting, closing, templates } = dressing;
  const g = preview?.greeting ? firstLine(preview.greeting.text) : greeting === "none" ? "No greeting" : "Greeting";
  const c = preview?.closing ? firstLine(preview.closing.text) : closing === "none" ? "No closing" : "Closing";
  return (
    <>
      <ChipRow>
        <Chip label={g} icon="hand-wave-outline" selected={greeting !== "none" && Boolean(preview?.greeting)} onPress={() => setOpen(true)} testID="greeting-chip" />
        <Chip label={c.replace(/\n/g, " ")} icon="draw" selected={closing !== "none" && Boolean(preview?.closing)} onPress={() => setOpen(true)} testID="closing-chip" />
      </ChipRow>
      <Sheet visible={open} onClose={() => setOpen(false)} title="Greeting and closing" footer={<Button label="Done" full onPress={() => setOpen(false)} />}>
        <Stack gap="lg">
          <Picker title="Greeting" kind="greeting" templates={templates} value={greeting} onChange={dressing.setGreeting} />
          <Picker title="Closing" kind="closing" templates={templates} value={closing} onChange={dressing.setClosing} />
          <Stack gap="sm">
            <Text variant="label" tone="muted">The message as it will be sent</Text>
            <Box bg="sunken" radius="xl" p="md">
              <Text variant="body" selectable>{preview?.text ?? (body.trim() || "Write your message first.")}</Text>
            </Box>
            {preview?.warnings.map((w) => <Banner key={w} tone="warning">{w}</Banner>)}
          </Stack>
        </Stack>
      </Sheet>
    </>
  );
}

function Picker({ title, kind, templates, value, onChange }: { title: string; kind: TemplateKind; templates: Template[]; value: Choice; onChange: (c: Choice) => void }) {
  const mine = templatesOf(templates, kind);
  const options = useMemo<Option<string>[]>(
    () => [
      { value: "auto", label: "Automatic", description: "The best fit for the person, else your default" },
      { value: "none", label: "None" },
      ...mine.map((t) => ({ value: `id:${t.id}`, label: t.name, description: t.text.replace(/\n/g, " · ") })),
    ],
    [mine],
  );
  return (
    <Stack gap="xs">
      <Row justify="between">
        <Text variant="label" tone="muted">{title}</Text>
        <Text variant="caption" tone="subtle">{choiceLabel(value, templates)}</Text>
      </Row>
      <OptionList
        options={options}
        value={choiceKey(value)}
        onChange={(v) => onChange(v === "auto" || v === "none" ? v : { id: Number(v.slice(3)) })}
      />
    </Stack>
  );
}
