import { useCallback, useEffect, useState } from "react";

import { Avatar, Banner, Box, Button, EmptyState, FloatingButton, IconButton, ListItem, Screen, Sheet, Skeleton, Spinner, Stack, Text, TextField, TopBar } from "@financer/ui";

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
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [list, setList] = useState<Conversation[] | null>(null);
  const [unread, setUnread] = useState({ people: 0, updates: 0 });
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);

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

  const shownList = (list ?? []).filter((c) => !unreadOnly || c.unread > 0);

  const embedded = nav.exit === undefined;
  const label = view === "people" ? "People" : view === "topics" ? "Topics" : "Updates";
  const count = view === "people" ? unread.people : view === "updates" ? unread.updates : 0;
  const me = info?.address ? (info.address.name ?? info.address.email) : "Me";
  const go = (t: "calendar" | "templates" | "mailbox") => {
    setMenu(false);
    nav.reset();
    nav.setTab(t);
  };
  const pick = (v: View) => {
    setMenu(false);
    setView(v);
  };

  return (
    <Screen
      // like Gmail: no title bar, the search pill is the first thing on the page; a host that gives the module
      // a way out gets a bar of its own with the back button
      header={embedded ? undefined : <TopBar title="Mail" subtitle={info?.address ? info.address.email : undefined} onBack={nav.exit} />}
      footer={
        <Box>
          <FloatingButton icon="pencil-outline" label="Compose" extended soft onPress={() => nav.push({ name: "compose" })} />
        </Box>
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
        <TextField
          variant="primary"
          pill
          value={search}
          onChangeText={setSearch}
          placeholder="Search in mail"
          returnKeyType="search"
          clearable
          left={<IconButton icon="menu" label="Mail menu" size="sm" onPress={() => setMenu(true)} />}
          right={syncing ? <Spinner /> : <Avatar name={me} size="sm" />}
        />
        <Text variant="label" tone="muted">{count > 0 ? `${label} · ${count} new` : label}</Text>
      </Stack>
      {list === null ? (
        <Stack gap="md"><Skeleton /><Skeleton /><Skeleton /></Stack>
      ) : shownList.length === 0 ? (
        <EmptyState
          icon={view === "updates" ? "bell-outline" : "message-text-outline"}
          title={search ? "Nothing found" : unreadOnly ? "Nothing unread" : view === "updates" ? "No newsletters or notifications" : "No chats yet"}
          message={search ? "Try another name, topic or word." : view === "updates" ? "Mail from shops and mailing lists is kept here, away from your people." : "Mail from the same person arrives as one chat, so a conversation reads like one."}
          action={!search && view !== "updates" ? <Button label="Write a message" icon="pencil-plus-outline" onPress={() => nav.push({ name: "compose" })} /> : undefined}
        />
      ) : (
        <Stack gap="none">
          {shownList.map((c) => (
            <ConversationRow key={c.key} c={c} now={now()} fmt={fmt} onPress={() => nav.push({ name: "chat", key: c.key })} />
          ))}
        </Stack>
      )}
      <Sheet visible={menu} onClose={() => setMenu(false)} title="Mail">
        <Stack gap="none" px="xl" pb="xl">
          <ListItem icon="account-outline" tile title="People" subtitle={view === "people" ? "Showing now" : undefined} value={unread.people ? `${unread.people} new` : undefined} onPress={() => pick("people")} />
          <ListItem icon="tag-outline" tile title="Topics" subtitle={view === "topics" ? "Showing now" : undefined} onPress={() => pick("topics")} />
          <ListItem icon="bell-outline" tile title="Updates" subtitle={view === "updates" ? "Showing now" : undefined} value={unread.updates ? `${unread.updates} new` : undefined} onPress={() => pick("updates")} />
          <ListItem icon="email-outline" tile title="Unread only" subtitle={unreadOnly ? "On" : "Off"} role="switch" checked={unreadOnly} onPress={() => { setUnreadOnly(!unreadOnly); setMenu(false); }} />
          <ListItem icon="sync" tile title="Check for new mail" onPress={() => { setMenu(false); void syncNow(); }} />
          <ListItem icon="calendar-month-outline" tile title="Calendar" subtitle="Events found in your mail" onPress={() => go("calendar")} />
          <ListItem icon="text-box-outline" tile title="Templates" subtitle="Greeting and closing" onPress={() => go("templates")} />
          <ListItem icon="cog-outline" tile title="Mailbox" subtitle="The account the mail comes from" onPress={() => go("mailbox")} />
        </Stack>
      </Sheet>
    </Screen>
  );
}
