import { useState } from "react";

import { Banner, Button, Screen, Section, Stack, TextField, TopBar, Box } from "@financer/ui";

import { MailApiError } from "../../api/client";
import { sendProblem } from "../../logic/compose";
import { TemplateBar, useDressing } from "../components/TemplateBar";
import { useNav } from "../nav";
import { useMail } from "../runtime";

/** A new topic: who, what about, and the text. Greeting and closing go on at the end. */
export function ComposeScreen({ to: initialTo = "", subject: initialSubject = "" }: { to?: string; subject?: string }) {
  const { client, bump } = useMail();
  const nav = useNav();
  const [to, setTo] = useState(initialTo);
  const [cc, setCc] = useState("");
  const [showCc, setShowCc] = useState(false);
  const [subject, setSubject] = useState(initialSubject);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string[]>([]);
  const dressing = useDressing(client, to.trim() ? [to] : [], body);

  const problem = sendProblem({ to, body, subject, isReply: false });

  const send = async () => {
    if (!client || problem) return;
    setBusy(true);
    setError([]);
    try {
      await client.send({ to: [to], cc: cc.trim() ? [cc] : [], subject, body, greeting: dressing.greeting, closing: dressing.closing });
      bump();
      nav.pop();
    } catch (e) {
      setError(e instanceof MailApiError ? [e.message, ...e.problems] : ["Could not send."]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      maxW="normal"
      header={<TopBar title="New message" onBack={nav.pop} />}
      footer={
        <Box bg="surface" px={{ base: "lg", md: "xl" }} py="md" gap="sm">
          <Button label="Send" icon="send" size="lg" full loading={busy} disabled={Boolean(problem)} onPress={() => void send()} testID="compose-send" />
        </Box>
      }
    >
      {error.length > 0 ? <Banner tone="danger" title="That did not work">{error.join(" ")}</Banner> : null}
      <Section title="Who and what about" card>
        <Stack gap="md">
          <TextField label="To" value={to} onChangeText={setTo} placeholder="max@example.com" keyboardType="email-address" helper="Several people: separate them with commas." testID="compose-to" />
          {showCc ? <TextField label="Cc" value={cc} onChangeText={setCc} placeholder="anna@example.com" keyboardType="email-address" /> : <Box><Button label="Add Cc" variant="ghost" size="sm" icon="plus" onPress={() => setShowCc(true)} /></Box>}
          <TextField label="Subject" value={subject} onChangeText={setSubject} placeholder="What is it about?" capitalize helper="Mail about the same subject stays together as one topic." testID="compose-subject" />
        </Stack>
      </Section>
      <Section title="Message" description="Write only what you want to say. The greeting and closing are added when it is sent." card>
        <Stack gap="md">
          <TextField value={body} onChangeText={setBody} placeholder="Write your message" multiline capitalize testID="compose-body" />
          <TemplateBar dressing={dressing} body={body} />
        </Stack>
      </Section>
    </Screen>
  );
}
