import type { MailChat } from "@/globalSearch";
import { wireFor } from "../../../../packages/wire/src/connect";

type Server = { baseUrl: string; token: string };
type Conversation = { key: string; title: string; preview: string; topics: string[] };
type Client = { conversations: (q: { by?: "person" | "topic"; scope?: "people" | "updates"; limit?: number }) => Promise<{ conversations: Conversation[] }> };

// The mail client is bundled source from packages/mail (see MailEntry); it is loaded the same way.
const { MailClient, mailCaller } = require("../../../../packages/mail/src") as {
  MailClient: new (caller: unknown) => Client;
  mailCaller: (wire: unknown) => unknown;
};

/** The chats of the person's mail, for the app's search. Rejects when the server has no mail client. */
export async function loadMailChats(server: Server): Promise<MailChat[]> {
  const client = new MailClient(mailCaller(await wireFor(server)));
  const [people, updates] = await Promise.all([client.conversations({ by: "person", scope: "people", limit: 200 }), client.conversations({ by: "person", scope: "updates", limit: 100 })]);
  return [...people.conversations, ...updates.conversations].map((c) => ({ key: c.key, title: c.title, preview: c.preview, topics: c.topics }));
}
