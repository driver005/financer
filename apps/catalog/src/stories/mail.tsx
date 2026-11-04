import { Avatar, Badge, Box, Card, ChatBubble, DateBadge, DividerLabel, Row, Stack, Text, tones, type Tone } from "@financer/ui";

import type { StoryDef } from "../Story";

function Avatars() {
  return (
    <Stack gap="lg">
      <Row gap="md" wrap>
        {["Max Müller", "Anna Berg", "Tom Fischer", "Lea Schmidt", "Jan Weber", "shop@news.example.com"].map((n) => (
          <Avatar key={n} name={n} />
        ))}
      </Row>
      <Row gap="md">
        <Avatar name="Max Müller" size="sm" />
        <Avatar name="Max Müller" size="md" />
        <Avatar name="Max Müller" size="lg" />
        {tones.filter((t: Tone) => t !== "neutral").map((t: Tone) => (
          <Avatar key={t} name={t} tone={t} />
        ))}
      </Row>
    </Stack>
  );
}

function Bubbles() {
  return (
    <Stack gap="sm">
      <DividerLabel label="Mon 2 November" />
      <ChatBubble text="Hast du Lust auf Fußball? Freitag um 19 Uhr auf dem Platz." time="18:00" />
      <ChatBubble mine text="Klar, ich bin dabei." time="19:02" />
      <DividerLabel label="Treffen am Wochenende" />
      <ChatBubble text="Super! Kannst du den Ball mitbringen?" time="08:00" unread note="Quoted text hidden" />
      <ChatBubble mine text="Mache ich." time="09:15">
        <Row gap="xs">
          <Badge label="Added to the calendar: Fri 19:00" tone="success" icon="calendar-check" />
        </Row>
      </ChatBubble>
      <ChatBubble sender="Anna Berg" text="Ich komme auch, wenn noch ein Platz frei ist. Und ich kann etwas zu trinken mitbringen." time="09:40" />
      <ChatBubble mine text={"A long message: the bubble stops short of the far edge, so a chat always reads as two sides, and it wraps inside its own width instead of filling the row from edge to edge."} time="09:41" />
    </Stack>
  );
}

function DateBadges() {
  return (
    <Row gap="md" wrap>
      <DateBadge weekday="Mon" day="2" />
      <DateBadge weekday="Tue" day="3" today />
      <DateBadge weekday="Fri" day="6" tone="success" />
      <DateBadge weekday="Sat" day="14" tone="warning" />
    </Row>
  );
}

function DividerLabels() {
  return (
    <Stack gap="lg">
      <DividerLabel label="Today" />
      <Box bg="sunken" radius="xl" p="md"><DividerLabel label="Treffen am Freitag" /></Box>
      <Card variant="flat"><Text variant="caption" tone="muted">Used for the day in a chat and for a topic that starts.</Text></Card>
    </Stack>
  );
}

export const mailStories: StoryDef[] = [
  { id: "avatar", title: "Avatar", note: "A person as their initials. The colour comes from the name, so the same person always looks the same.", render: () => <Avatars /> },
  { id: "bubble", title: "Chat bubble", note: "Yours on the right in the accent colour, theirs on the left; both stop short of the far edge.", render: () => <Bubbles /> },
  { id: "date-badge", title: "Date badge", note: "A day as a small calendar tile, for the agenda.", render: () => <DateBadges /> },
  { id: "divider-label", title: "Divider with a label", note: "The day or the topic in a chat.", render: () => <DividerLabels /> },
];
