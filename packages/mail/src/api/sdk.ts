// The Rust SDK (crates/sdk) as a mail backend. The SDK's generated TypeScript speaks camelCase, bigint
// for 64-bit numbers, numeric enums and optional (absent) values; the screens speak snake_case, plain
// numbers, words and null. This file is the one place that translates, in both directions.

import { MailApiError } from "./client";
import type { MailBackend } from "./backend";
import type { CalendarEvent, Choice, ListQuery, NewEvent, PreviewRequest, SendRequest, Template } from "./types";

/** The generated enums and constructors, handed over by the host (they do not exist at type-check time). */
export type SdkModule = {
  MailSdk: new (baseUrl: string, token: string) => MailSdkLike;
  /** `Choice.Auto`, `Choice.None` and `Choice.Id` of the generated module. */
  Choice: {
    Auto: new () => unknown;
    None: new () => unknown;
    Id: new (v: { id: bigint }) => unknown;
  };
  ConversationKind: Record<string, string | number>;
  TemplateKind: Record<string, string | number>;
  /** Present for the WebAssembly build: load the module before the first call. */
  uniffiInitAsync?: () => Promise<void>;
};

/** The calls of the generated `MailSdk` that the screens use. */
export interface MailSdkLike {
  info(): Promise<unknown>;
  sync(): Promise<unknown>;
  conversations(by: string | undefined, scope: string | undefined, q: string | undefined, limit: number | undefined): Promise<unknown>;
  conversation(key: string): Promise<unknown>;
  markRead(key: string): Promise<unknown>;
  message(id: bigint): Promise<unknown>;
  templates(): Promise<unknown>;
  createTemplate(template: unknown): Promise<unknown>;
  updateTemplate(template: unknown): Promise<unknown>;
  deleteTemplate(id: bigint): Promise<void>;
  preview(request: unknown): Promise<unknown>;
  send(request: unknown): Promise<unknown>;
  events(from: string | undefined, to: string | undefined, includeCancelled: boolean): Promise<unknown>;
  createEvent(event: unknown): Promise<unknown>;
  removeEvent(id: bigint): Promise<void>;
  restoreEvent(id: bigint): Promise<unknown>;
}

const toSnake = (k: string) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
const toCamel = (k: string) => k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

/** The name of an enum member, from the generated enum (numeric, with reverse names) or a string one. */
function memberName(e: Record<string, string | number>, v: unknown): string {
  if (typeof v === "string") return v.toLowerCase();
  const name = e[v as number];
  return String(name ?? v).toLowerCase();
}

/**
 * SDK to screens: snake_case keys, numbers for bigints, words for enums, `null` for what is absent.
 * `kinds` is the enum the `kind` fields of this answer belong to (conversations or templates).
 */
export function fromSdk(value: unknown, kinds?: Record<string, string | number>): unknown {
  if (typeof value === "bigint") return Number(value);
  if (Array.isArray(value)) return value.map((v) => fromSdk(v, kinds));
  if (value === undefined) return null;
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const key = toSnake(k);
      out[key] = key === "kind" && kinds && v !== null && v !== undefined ? memberName(kinds, v) : fromSdk(v, kinds);
    }
    return out;
  }
  return value;
}

const BIG_KEYS = new Set(["id", "replyTo"]);

/** Screens to SDK: camelCase keys, bigints where the SDK has 64-bit numbers, `undefined` for null. */
function toSdkStruct(value: unknown, m: SdkModule): unknown {
  if (Array.isArray(value)) return value.map((v) => toSdkStruct(v, m));
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const key = toCamel(k);
      if (v === null || v === undefined) continue;
      if (BIG_KEYS.has(key) && typeof v === "number") out[key] = BigInt(v);
      else if (key === "greeting" || key === "closing") out[key] = choice(v as Choice, m);
      else if (key === "kind") out[key] = (m.TemplateKind as Record<string, unknown>)[String(v).replace(/^./, (c) => c.toUpperCase())];
      else out[key] = toSdkStruct(v, m);
    }
    return out;
  }
  return value;
}

function choice(c: Choice, m: SdkModule): unknown {
  if (c === "auto") return new m.Choice.Auto();
  if (c === "none") return new m.Choice.None();
  return new m.Choice.Id({ id: BigInt(c.id) });
}

/** The SDK's own error (an object with the reasons) as the screens' error. */
function asApiError(e: unknown): never {
  const any = e as { inner?: { status?: number; message?: string; problems?: string[] }; message?: string } | undefined;
  const inner = any?.inner;
  if (inner && typeof inner.status === "number") throw new MailApiError(inner.status, inner.message ?? "request failed", inner.problems ?? []);
  throw new MailApiError(0, any?.inner?.message ?? any?.message ?? String(e));
}

/** The mail backend that calls Rust. */
export class SdkMailClient implements MailBackend {
  private constructor(
    private sdk: MailSdkLike,
    private m: SdkModule,
  ) {}

  /** Loads the module when it needs loading (the browser) and connects to the server. */
  static async connect(m: SdkModule, baseUrl: string, token: string): Promise<SdkMailClient> {
    await m.uniffiInitAsync?.();
    return new SdkMailClient(new m.MailSdk(baseUrl, token), m);
  }

  private async run<T>(call: () => Promise<unknown>, kinds?: Record<string, string | number>): Promise<T> {
    try {
      return fromSdk(await call(), kinds) as T;
    } catch (e) {
      return asApiError(e);
    }
  }

  info = () => this.run<Awaited<ReturnType<MailBackend["info"]>>>(() => this.sdk.info());
  sync = () => this.run<Awaited<ReturnType<MailBackend["sync"]>>>(() => this.sdk.sync());
  conversations = (q: ListQuery = {}) => this.run<Awaited<ReturnType<MailBackend["conversations"]>>>(() => this.sdk.conversations(q.by, q.scope, q.q, q.limit), this.m.ConversationKind);
  conversation = (key: string) => this.run<Awaited<ReturnType<MailBackend["conversation"]>>>(() => this.sdk.conversation(key), this.m.ConversationKind);
  markRead = (key: string) => this.run<{ marked: number }>(() => this.sdk.markRead(key));
  message = (id: number) => this.run<Awaited<ReturnType<MailBackend["message"]>>>(() => this.sdk.message(BigInt(id)));
  templates = () => this.run<Awaited<ReturnType<MailBackend["templates"]>>>(() => this.sdk.templates(), this.m.TemplateKind);
  createTemplate = (t: Omit<Template, "id">) => this.run<Template>(() => this.sdk.createTemplate(toSdkStruct({ ...t, id: 0 }, this.m)), this.m.TemplateKind);
  updateTemplate = (t: Template) => this.run<Template>(() => this.sdk.updateTemplate(toSdkStruct(t, this.m)), this.m.TemplateKind);
  deleteTemplate = (id: number) => this.run<void>(() => this.sdk.deleteTemplate(BigInt(id)));
  preview = (r: PreviewRequest) => this.run<Awaited<ReturnType<MailBackend["preview"]>>>(() => this.sdk.preview(toSdkStruct(r, this.m)));
  send = (r: SendRequest) => this.run<Awaited<ReturnType<MailBackend["send"]>>>(() => this.sdk.send(toSdkStruct({ ...r, cc: r.cc ?? [], bcc: r.bcc ?? [], subject: r.subject ?? "" }, this.m)));
  events = (range: { from?: string; to?: string; includeCancelled?: boolean } = {}) =>
    this.run<Awaited<ReturnType<MailBackend["events"]>>>(() => this.sdk.events(range.from, range.to, range.includeCancelled === true));
  createEvent = (e: NewEvent) => this.run<CalendarEvent>(() => this.sdk.createEvent(toSdkStruct({ ...e, all_day: e.all_day ?? false }, this.m)));
  removeEvent = (id: number) => this.run<void>(() => this.sdk.removeEvent(BigInt(id)));
  restoreEvent = (id: number) => this.run<CalendarEvent>(() => this.sdk.restoreEvent(BigInt(id)));
}
