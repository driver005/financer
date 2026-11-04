// The shapes the mail API (`/v1/mail`) sends and takes. See crates/mail-api.

export type Address = { name: string | null; email: string };

export type ConversationKind = "person" | "topic";

export type Conversation = {
  key: string;
  kind: ConversationKind;
  title: string;
  /** The people other than you. */
  people: Address[];
  count: number;
  unread: number;
  /** Seconds since the epoch. */
  last_at: number;
  last_from_me: boolean;
  preview: string;
  /** The latest topics talked about, for a person's chat. */
  topics: string[];
  /** A newsletter, a shop, a notification. */
  automated: boolean;
};

export type ConversationList = {
  conversations: Conversation[];
  unread_people: number;
  unread_updates: number;
};

export type EventSource = "invite" | "text" | "manual";

export type CalendarEvent = {
  id: number;
  status: "active" | "cancelled";
  /** The message it was found in. */
  message: number | null;
  uid: string;
  title: string;
  /** `2026-11-06T19:00`, wall-clock time of the mailbox owner. */
  start: string;
  end: string | null;
  all_day: boolean;
  location: string | null;
  description: string | null;
  organizer: string | null;
  source: EventSource;
  sequence: number;
  cancelled: boolean;
  recurrence: string | null;
  note: string | null;
};

export type ChatMessage = {
  id: number;
  mine: boolean;
  from: Address;
  to: Address[];
  cc: Address[];
  at: number;
  subject: string;
  /** The subject without "Re:". */
  topic: string;
  /** What was said: no quoted chain, signature, greeting or closing. */
  text: string;
  trimmed: boolean;
  unread: boolean;
  events: CalendarEvent[];
};

export type ConversationDetail = {
  conversation: Conversation;
  messages: ChatMessage[];
  /** Who a reply goes to. */
  reply_to: Address[];
  /** The newest message, to answer it (keeps the thread together). */
  reply_to_message: number | null;
};

export type MessageDetail = {
  id: number;
  message_id: string;
  folder: string;
  outgoing: boolean;
  from: Address;
  to: Address[];
  cc: Address[];
  subject: string;
  at: number;
  body: string;
};

export type TemplateKind = "greeting" | "closing";

export type Template = {
  id: number;
  kind: TemplateKind;
  name: string;
  text: string;
  fallback: string | null;
  /** Addresses (`max@x.de`) or domains (`@firma.de`); empty means anyone. */
  audience: string[];
  is_default: boolean;
};

export type Placeholder = { name: string; description: string };

export type TemplateList = { templates: Template[]; placeholders: Placeholder[] };

/** Which template to put on: the best fit for the recipients, none, or one chosen. */
export type Choice = "auto" | "none" | { id: number };

export type UsedTemplate = { id: number; name: string; text: string };

export type Preview = {
  /** The message as it would be sent. */
  text: string;
  greeting: UsedTemplate | null;
  closing: UsedTemplate | null;
  warnings: string[];
};

export type PreviewRequest = { to: string[]; body: string; greeting: Choice; closing: Choice };

export type SendRequest = {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject?: string;
  body: string;
  greeting: Choice;
  closing: Choice;
  /** The message this answers (its id). */
  reply_to?: number | null;
};

export type SendResult = { id: number; message_id: string; text: string; warnings: string[] };

export type SyncReport = {
  at: number;
  fetched: number;
  stored: number;
  duplicates: number;
  skipped: number;
  events: number;
  more: boolean;
  error: string | null;
};

export type MailInfo = {
  configured: boolean;
  address: Address | null;
  timezone: string;
  poll_minutes: number;
  messages: number;
  unread: number;
  syncing: boolean;
  last_sync: SyncReport | null;
};

export type EventsResponse = { from: string; to: string; events: CalendarEvent[] };

export type NewEvent = {
  title: string;
  start: string;
  end?: string | null;
  all_day?: boolean;
  location?: string | null;
  description?: string | null;
};

export type ListQuery = {
  by?: "person" | "topic";
  scope?: "people" | "updates" | "all";
  q?: string;
  limit?: number;
};
