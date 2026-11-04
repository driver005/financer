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
import { bind, CallError, type Caller, type WireLike } from "../../../wire/src";

export class MailApiError extends CallError {
  constructor(status: number, message: string, problems: string[] = []) {
    super(status, status === 404 ? "This server has no mail client. It needs a build with the mail feature (docs/MAIL.md)." : message, problems);
  }
}

/** The mail API of a connection (a server through the Rust SDK). */
export function mailCaller(wire: WireLike): Caller {
  return bind(wire, "mail", MailApiError);
}

/**
 * The mail API (`/v1/mail`) as the screens use it. Every method names a call of the Rust SDK and
 * passes its values by name; the paths, the encoding and the checking of the answer are the SDK's
 * (crates/sdk, docs/SDK.md).
 */
export class MailClient {
  constructor(private caller: Caller) {}

  private op<T>(op: string, args?: Record<string, unknown>) {
    return this.caller.call<T>(op, args);
  }

  info(): Promise<MailInfo> {
    return this.op("info");
  }

  sync(): Promise<SyncReport> {
    return this.op("sync");
  }

  conversations(q: ListQuery = {}): Promise<ConversationList> {
    return this.op("conversations", { by: q.by, scope: q.scope, q: q.q?.trim() || undefined, limit: q.limit });
  }

  conversation(key: string): Promise<ConversationDetail> {
    return this.op("conversation", { key });
  }

  markRead(key: string): Promise<{ marked: number }> {
    return this.op("mark_read", { key });
  }

  message(id: number): Promise<MessageDetail> {
    return this.op("message", { id });
  }

  templates(): Promise<TemplateList> {
    return this.op("templates");
  }

  createTemplate(t: Omit<Template, "id">): Promise<Template> {
    return this.op("create_template", { body: t });
  }

  updateTemplate(t: Template): Promise<Template> {
    return this.op("update_template", { body: t });
  }

  deleteTemplate(id: number): Promise<void> {
    return this.op("delete_template", { id });
  }

  preview(req: PreviewRequest): Promise<Preview> {
    return this.op("preview", { body: req });
  }

  send(req: SendRequest): Promise<SendResult> {
    return this.op("send", { body: req });
  }

  events(range: { from?: string; to?: string; includeCancelled?: boolean } = {}): Promise<EventsResponse> {
    return this.op("events", { from: range.from, to: range.to, include_cancelled: range.includeCancelled ? true : undefined });
  }

  createEvent(e: NewEvent): Promise<CalendarEvent> {
    return this.op("create_event", { body: e });
  }

  removeEvent(id: number): Promise<void> {
    return this.op("remove_event", { id });
  }

  restoreEvent(id: number): Promise<CalendarEvent> {
    return this.op("restore_event", { id });
  }
}

export type { Choice };
