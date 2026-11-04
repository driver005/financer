import { useCallback, useEffect, useState } from "react";

import { Banner, Button, Divider, EmptyState, IconButton, Screen, SearchBar, Segmented, Skeleton, Spinner, Stack, TopBar } from "@financer/ui";

import { MailApiError } from "../../api/client";
import type { Conversation } from "../../api/types";
import { ConversationRow } from "../components/ConversationRow";
import { useNav } from "../nav";
import { useMail } from "../runtime";

type View = "people" | "topics" | "updates";

/** The first tab: every chat, by person or by topic, newest first. */
export function ChatsScreen() {
  const { client, info, fmt, now, version, syncing, syncNow } = useMail();
  const nav = useNav();
  const [view, setView] = useState<View>("people");
  const [search, setSearch] = useState("");
  const [list, setList] = useState<Conversation[] | null>(null);
  const [unread, setUnread] = useState({ people: 0, updates: 0 });
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!client) return;
    try {
      const r = await client.conversations({ by: view === "topics" ? "topic" : "person", scope: view === "updates" ? "updates" : "people", q: search });
      setList(r.conversations);
      setUnread({ people: r.unread_people, updates: r.unread_updates });
      setError(null);
    } catch (e) {
      setError(e instanceof MailApiError ? e.message : "Could not load the chats.");
    }
  }, [client, view, search]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), search ? 250 : 0);
    return () => clearTimeout(timer);
  }, [load, version, search]);

  const options = [
    { value: "people" as const, label: unread.people ? `People (${unread.people})` : "People" },
    { value: "topics" as const, label: "Topics" },
    { value: "updates" as const, label: unread.updates ? `Updates (${unread.updates})` : "Updates" },
  ];

  return (
    <Screen
      header={
        <TopBar
          title="Mail"
          subtitle={info?.address ? info.address.email : undefined}
          onBack={nav.exit}
          actions={
            <>
              {syncing ? <Spinner /> : <IconButton icon="sync" label="Check for new mail" onPress={() => void syncNow()} disabled={!info?.configured} />}
              <IconButton icon="pencil-plus-outline" label="New message" variant="soft" tone="accent" onPress={() => nav.push({ name: "compose" })} />
            </>
          }
        />
      }
      maxW="normal"
    >
      {error ? <Banner tone="danger" action={<Button label="Try again" variant="outline" tone="neutral" size="sm" onPress={() => void load()} />}>{error}</Banner> : null}
      {info && !info.configured ? (
        <Banner tone="info" title="No mailbox yet" action={<Button label="How to connect" variant="outline" tone="neutral" size="sm" onPress={() => nav.setTab("mailbox")} />}>
          Templates and the calendar work already. Connect a mailbox on the server to read and send mail.
        </Banner>
      ) : null}
      {info?.last_sync?.error ? <Banner tone="warning" title="The last check failed">{info.last_sync.error}</Banner> : null}
      <Stack gap="md">
        <SearchBar value={search} onChangeText={setSearch} placeholder="Search people, topics and words" />
        <Segmented value={view} onChange={setView} options={options} testID="chat-view" />
      </Stack>
      {list === null ? (
        <Stack gap="md"><Skeleton /><Skeleton /><Skeleton /></Stack>
      ) : list.length === 0 ? (
        <EmptyState
          icon={view === "updates" ? "bell-outline" : "message-text-outline"}
          title={search ? "Nothing found" : view === "updates" ? "No newsletters or notifications" : "No chats yet"}
          message={search ? "Try another name, topic or word." : view === "updates" ? "Mail from shops and mailing lists is kept here, away from your people." : "Mail from the same person arrives as one chat, so a conversation reads like one."}
          action={!search && view !== "updates" ? <Button label="Write a message" icon="pencil-plus-outline" onPress={() => nav.push({ name: "compose" })} /> : undefined}
        />
      ) : (
        <Stack gap="none">
          {list.map((c, i) => (
            <Stack key={c.key} gap="none">
              {i > 0 ? <Divider /> : null}
              <ConversationRow c={c} now={now()} fmt={fmt} onPress={() => nav.push({ name: "chat", key: c.key })} />
            </Stack>
          ))}
        </Stack>
      )}
    </Screen>
  );
}
