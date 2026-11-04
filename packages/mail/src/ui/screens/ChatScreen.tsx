import { useCallback, useEffect, useState } from "react";

import { Banner, Box, Button, ChatBubble, DividerLabel, EmptyState, IconButton, Row, Screen, Sheet, Skeleton, Stack, Text, TextField, TopBar, Touchable, Chip, Avatar } from "@financer/ui";

import { MailApiError } from "../../api/client";
import type { ConversationDetail, MessageDetail } from "../../api/types";
import { chatRows, unreadIds } from "../../logic/chat";
import { peopleText, recipientStrings } from "../../logic/compose";
import { EventNote } from "../components/EventNote";
import { TemplateBar, useDressing } from "../components/TemplateBar";
import { useNav } from "../nav";
import { useMail } from "../runtime";

/** One chat: the bubbles, oldest first, and the box to answer in. */
export function ChatScreen({ chatKey }: { chatKey: string }) {
  const { client, fmt, now, version, bump } = useMail();
  const nav = useNav();
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [original, setOriginal] = useState<MessageDetail | null>(null);

  const people = detail?.reply_to ?? [];
  const to = recipientStrings(people);
  const dressing = useDressing(client, to, text);

  const load = useCallback(async () => {
    if (!client) return;
    try {
      const d = await client.conversation(chatKey);
      setDetail(d);
      setError(null);
      if (unreadIds(d.messages).length > 0) {
        await client.markRead(chatKey).catch(() => undefined);
        bump();
      }
    } catch (e) {
      setError(e instanceof MailApiError ? e.message : "Could not open this chat.");
    }
    // bump would reload this effect in a loop
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, chatKey]);
  // reloads when mail changed; opening marks the chat read once, so this settles after one extra pass
  useEffect(() => void load(), [load, version]);

  const send = async () => {
    if (!client || !detail || !text.trim()) return;
    setSending(true);
    setError(null);
    try {
      await client.send({ to, body: text, greeting: dressing.greeting, closing: dressing.closing, reply_to: detail.reply_to_message });
      setText("");
      await load();
      bump();
    } catch (e) {
      setError(e instanceof MailApiError ? [e.message, ...e.problems].join(" ") : "Could not send.");
    } finally {
      setSending(false);
    }
  };

  const c = detail?.conversation;
  const topicChat = c?.kind === "topic";
  const rows = detail ? chatRows(detail.messages, { now: now(), fmt, showTopics: !topicChat, groupChat: (c?.people.length ?? 0) > 1 }) : [];
  const canReply = to.length > 0;

  return (
    <Screen
      startAtEnd
      maxW="normal"
      header={
        <TopBar
          title={c?.title ?? "Chat"}
          subtitle={c ? (topicChat ? peopleText(c.people) : c.people.map((p) => p.email).join(", ")) : undefined}
          onBack={nav.pop}
          actions={
            <>
              {c && !topicChat ? <Avatar name={c.title} size="sm" /> : null}
              {c ? <IconButton icon="pencil-plus-outline" label="New topic with this person" onPress={() => nav.push({ name: "compose", to: to.join(", ") })} /> : null}
            </>
          }
        />
      }
      footer={
        canReply ? (
          <Box bg="surface" px={{ base: "lg", md: "xl" }} py="md" gap="sm">
            {error ? <Banner tone="danger" title="That did not work">{error}</Banner> : null}
            <TemplateBar dressing={dressing} body={text} />
            <Row gap="sm" align="end">
              <Box grow>
                <TextField value={text} onChangeText={setText} placeholder={topicChat ? "Reply in this topic" : "Write a message"} multiline compact capitalize variant="primary" testID="chat-input" />
              </Box>
              <IconButton icon="send" label="Send" variant="solid" tone="accent" disabled={!text.trim() || sending} onPress={() => void send()} testID="chat-send" />
            </Row>
          </Box>
        ) : undefined
      }
    >
      {error && !detail ? <Banner tone="danger" title="That did not work">{error}</Banner> : null}
      {!detail && !error ? (
        <Stack gap="md"><Skeleton /><Skeleton /></Stack>
      ) : detail && rows.length === 0 ? (
        <EmptyState icon="message-outline" title="No messages" />
      ) : (
        <Stack gap="md">
          {rows.map((r) => {
            if (r.kind === "day") return <DividerLabel key={r.key} label={r.label} />;
            if (r.kind === "topic") return <Row key={r.key} justify="center"><Chip label={r.label} icon="tag-outline" /></Row>;
            const m = r.message;
            const bubble = (
              <ChatBubble mine={m.mine} text={m.text} time={r.time} sender={r.showSender ? (m.from.name ?? m.from.email) : undefined} unread={m.unread} note={m.trimmed ? "Quoted text hidden. Tap to read the original." : undefined}>
                {m.events.map((e) => <EventNote key={e.id} event={e} fmt={fmt} />)}
              </ChatBubble>
            );
            return m.trimmed ? (
              <Touchable key={r.key} label="Read the original message" hit={false} onPress={() => void client?.message(m.id).then(setOriginal).catch(() => undefined)}>
                {bubble}
              </Touchable>
            ) : (
              <Box key={r.key}>{bubble}</Box>
            );
          })}
        </Stack>
      )}
      <Sheet visible={original !== null} onClose={() => setOriginal(null)} title={original?.subject || "Original message"}>
        <Stack gap="sm">
          <Text variant="caption" tone="muted">{original ? `${original.from.name ?? original.from.email}, ${original.folder}` : ""}</Text>
          <Text variant="body" selectable>{original?.body ?? ""}</Text>
        </Stack>
      </Sheet>
      {!canReply && detail ? <Button label="Back" variant="outline" tone="neutral" onPress={nav.pop} /> : null}
    </Screen>
  );
}
