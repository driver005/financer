import { AppShell, Box, Button, EmptyState, Screen, ThemeProvider, TopBar, type NavItem } from "@financer/ui";

import type { MailHost } from "../host";
import { NavProvider, useNav, type Route, type Tab } from "./nav";
import { MailRuntime, useMail } from "./runtime";
import { CalendarScreen } from "./screens/CalendarScreen";
import { ChatScreen } from "./screens/ChatScreen";
import { ChatsScreen } from "./screens/ChatsScreen";
import { ComposeScreen } from "./screens/ComposeScreen";
import { MailboxScreen } from "./screens/MailboxScreen";
import { TemplateEditorScreen } from "./screens/TemplateEditorScreen";
import { TemplatesScreen } from "./screens/TemplatesScreen";

const TABS: NavItem<Tab>[] = [
  { key: "chats", label: "Chats", icon: "message-text-outline", activeIcon: "message-text" },
  { key: "calendar", label: "Calendar", icon: "calendar-month-outline", activeIcon: "calendar-month" },
  { key: "templates", label: "Templates", icon: "text-box-outline", activeIcon: "text-box" },
  { key: "mailbox", label: "Mailbox", icon: "email-outline", activeIcon: "email" },
];

/**
 * The whole mail client as one component. The host gives it the server to talk to and renders it
 * wherever it wants. It follows the system's light or dark setting and the window's size (bottom
 * bar, rail or sidebar).
 */
export function MailModule({ host }: { host: MailHost }) {
  return (
    <ThemeProvider>
      <MailRuntime host={host}>
        <NavProvider exit={host.onExit}>
          <Shell />
        </NavProvider>
      </MailRuntime>
    </ThemeProvider>
  );
}

function Shell() {
  const mail = useMail();
  const nav = useNav();
  const top = nav.stack[nav.stack.length - 1];
  const content =
    mail.status === "loading" ? (
      <Screen header={<TopBar title="Mail" onBack={nav.exit} />}><EmptyState icon="email-outline" title="Opening…" /></Screen>
    ) : mail.status !== "ready" ? (
      <Screen header={<TopBar title="Mail" onBack={nav.exit} />}>
        <EmptyState
          card
          icon="server-off"
          title={mail.status === "no-server" ? "Connect to your server" : "Could not reach the mail client"}
          message={mail.status === "no-server" ? "The mail client lives on your Financer server. Connect to it in Settings first." : (mail.error ?? "Check the server address and token in Settings.")}
          action={nav.exit ? <Button label="Back" variant="soft" onPress={nav.exit} /> : undefined}
        />
      </Screen>
    ) : top ? (
      <Routed route={top} />
    ) : (
      <TabScreen tab={nav.tab} />
    );
  const badge = mail.info?.unread ?? 0;
  const items = TABS.map((t) => (t.key === "chats" && badge > 0 ? { ...t, label: `Chats (${badge})` } : t));
  return (
    <AppShell items={items} active={nav.tab} onChange={(t) => { nav.reset(); nav.setTab(t); }} title="Mail">
      <Box grow>{content}</Box>
    </AppShell>
  );
}

function TabScreen({ tab }: { tab: Tab }) {
  switch (tab) {
    case "chats":
      return <ChatsScreen />;
    case "calendar":
      return <CalendarScreen />;
    case "templates":
      return <TemplatesScreen />;
    case "mailbox":
      return <MailboxScreen />;
  }
}

function Routed({ route }: { route: Route }) {
  switch (route.name) {
    case "chat":
      return <ChatScreen chatKey={route.key} />;
    case "compose":
      return <ComposeScreen to={route.to} subject={route.subject} />;
    case "template":
      return <TemplateEditorScreen id={route.id} kind={route.kind} />;
  }
}
