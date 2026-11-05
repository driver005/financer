import { useCallback, useEffect, useState } from "react";

import { Banner, Box, Button, Chip, Divider, EmptyState, FloatingButton, IconButton, ListItem, Row, Screen, SearchBar, Sheet, Skeleton, Spinner, Stack, TabStrip, Text, TopBar, type TabStripItem } from "@financer/ui";

import { MailApiError } from "../../api/client";
import type { Conversation } from "../../api/types";
import { listGroup } from "../../logic/format";
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

  // "3 unread" at the end of a day's heading, nothing when everything of that day is read
  const unreadIn = (group: string) => {
    const n = shownList.filter((c) => listGroup(c.last_at, now(), fmt) === group).reduce((sum, c) => sum + (c.unread > 0 ? 1 : 0), 0);
    return n > 0 ? `${n} unread` : "";
  };

  const embedded = nav.exit === undefined;
  const tabs: TabStripItem<View>[] = [
    { key: "people", label: "People", icon: "account-outline", badge: unread.people ? `${unread.people} new` : undefined },
    { key: "topics", label: "Topics", icon: "tag-outline" },
    { key: "updates", label: "Updates", icon: "bell-outline", badge: unread.updates ? `${unread.updates} new` : undefined },
  ];
  const tools = (
    <>
      {syncing ? <Spinner /> : <IconButton icon="sync" label="Check for new mail" onPress={() => void syncNow()} disabled={!info?.configured} />}
      <IconButton icon="dots-vertical" label="More: calendar, templates and mailbox" onPress={() => setMenu(true)} />
    </>
  );

  return (
    <Screen
      // like Gmail: no title bar, the search is the first thing on the page; a host that gives the module a way out
      // gets its back button in a bar of its own
      header={embedded ? undefined : <TopBar title="Mail" subtitle={info?.address ? info.address.email : undefined} onBack={nav.exit} actions={tools} />}
      footer={
        <Box>
          <FloatingButton icon="pencil-outline" label="Compose" extended onPress={() => nav.push({ name: "compose" })} />
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
      <Stack gap="sm">
        <Row gap="xs">
          <Box grow>
            <SearchBar value={search} onChangeText={setSearch} placeholder="Search in mail" />
          </Box>
          {embedded ? tools : null}
        </Row>
        <TabStrip items={tabs} value={view} onChange={setView} />
        <Divider />
        <Row gap="sm">
          <Chip label="Unread" icon="email-outline" selected={unreadOnly} onPress={() => setUnreadOnly(!unreadOnly)} testID="chat-unread-only" />
        </Row>
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
          {shownList.map((c, i) => {
            const group = listGroup(c.last_at, now(), fmt);
            const heading = i === 0 || group !== listGroup(shownList[i - 1].last_at, now(), fmt);
            return (
              <Stack key={c.key} gap="none">
                {heading ? (
                  <Row justify="between" pt={i === 0 ? "none" : "lg"} pb="xs">
                    <Text variant="label" tone="muted" level={2}>{group}</Text>
                    <Text variant="caption" tone="muted">{unreadIn(group)}</Text>
                  </Row>
                ) : (
                  <Divider />
                )}
                <ConversationRow c={c} now={now()} fmt={fmt} onPress={() => nav.push({ name: "chat", key: c.key })} />
              </Stack>
            );
          })}
        </Stack>
      )}
      <Sheet visible={menu} onClose={() => setMenu(false)} title="Mail">
        <Stack gap="none" px="xl" pb="xl">
          <ListItem icon="calendar-month-outline" tile title="Calendar" subtitle="Events found in your mail" onPress={() => { setMenu(false); nav.reset(); nav.setTab("calendar"); }} />
          <ListItem icon="text-box-outline" tile title="Templates" subtitle="Greeting and closing" onPress={() => { setMenu(false); nav.reset(); nav.setTab("templates"); }} />
          <ListItem icon="email-outline" tile title="Mailbox" subtitle="The account the mail comes from" onPress={() => { setMenu(false); nav.reset(); nav.setTab("mailbox"); }} />
        </Stack>
      </Sheet>
    </Screen>
  );
}
