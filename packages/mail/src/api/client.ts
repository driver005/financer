import type {
  CalendarEvent,
  Choice,
  ConversationDetail,
  ConversationList,
  EventsResponse,
  ListQuery,
  MailInfo,
  MessageDetail,
  NewEvent,
  Preview,
  PreviewRequest,
  SendRequest,
  SendResult,
  SyncReport,
  Template,
  TemplateList,
} from "./types";
import type { MailTransport } from "./transport";

export class MailApiError extends Error {
  constructor(
    public status: number,
    message: string,
    /** One entry per problem when the server refused a template or a recipient. */
    public problems: string[] = [],
  ) {
    super(message);
  }
}

const PREFIX = "/v1/mail";

function query(params: Record<string, string | number | boolean | undefined>): string {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return parts.length ? `?${parts.join("&")}` : "";
}

/** Typed client for the mail API (`/v1/mail`). */
export class MailClient {
  constructor(private transport: MailTransport) {}

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.transport.send({
      method,
      path: PREFIX + path,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status < 200 || res.status >= 300) {
      let message = `request failed (${res.status})`;
      let problems: string[] = [];
      try {
        const parsed = JSON.parse(res.text) as { error?: string; problems?: string[] };
        if (parsed.error) message = parsed.error;
        if (Array.isArray(parsed.problems)) problems = parsed.problems;
      } catch {
        if (res.status === 401) message = "The server did not accept the token.";
        else if (res.status === 404) message = "This server has no mail client. It needs a build with the mail feature (docs/MAIL.md).";
        else if (res.text && res.text.length < 200) message = res.text;
      }
      throw new MailApiError(res.status, message, problems);
    }
    return (res.status === 204 || res.text === "" ? undefined : JSON.parse(res.text)) as T;
  }

  info(): Promise<MailInfo> {
    return this.call("GET", "/info");
  }

  sync(): Promise<SyncReport> {
    return this.call("POST", "/sync", {});
  }

  conversations(q: ListQuery = {}): Promise<ConversationList> {
    return this.call("GET", `/conversations${query({ by: q.by, scope: q.scope, q: q.q?.trim(), limit: q.limit })}`);
  }

  conversation(key: string): Promise<ConversationDetail> {
    return this.call("GET", `/conversations/${encodeURIComponent(key)}`);
  }

  markRead(key: string): Promise<{ marked: number }> {
    return this.call("POST", `/conversations/${encodeURIComponent(key)}/read`, {});
  }

  message(id: number): Promise<MessageDetail> {
    return this.call("GET", `/messages/${id}`);
  }

  templates(): Promise<TemplateList> {
    return this.call("GET", "/templates");
  }

  createTemplate(t: Omit<Template, "id">): Promise<Template> {
    return this.call("POST", "/templates", t);
  }

  updateTemplate(t: Template): Promise<Template> {
    return this.call("PUT", `/templates/${t.id}`, t);
  }

  deleteTemplate(id: number): Promise<void> {
    return this.call("DELETE", `/templates/${id}`);
  }

  preview(req: PreviewRequest): Promise<Preview> {
    return this.call("POST", "/compose/preview", req);
  }

  send(req: SendRequest): Promise<SendResult> {
    return this.call("POST", "/send", req);
  }

  events(range: { from?: string; to?: string; includeCancelled?: boolean } = {}): Promise<EventsResponse> {
    return this.call("GET", `/events${query({ from: range.from, to: range.to, include_cancelled: range.includeCancelled ? true : undefined })}`);
  }

  createEvent(e: NewEvent): Promise<CalendarEvent> {
    return this.call("POST", "/events", e);
  }

  removeEvent(id: number): Promise<void> {
    return this.call("DELETE", `/events/${id}`);
  }

  restoreEvent(id: number): Promise<CalendarEvent> {
    return this.call("POST", `/events/${id}/restore`, {});
  }
}

export type { Choice };
