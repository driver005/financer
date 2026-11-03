// What the screens need from the mail API, whatever carries it: the TypeScript client over HTTP
// (`MailClient`, works everywhere including Expo Go) or the Rust SDK (`SdkMailClient`, in builds that
// have it). Both answer in the shapes of types.ts.

import type { MailClient } from "./client";

export type MailBackend = Pick<
  MailClient,
  | "info"
  | "sync"
  | "conversations"
  | "conversation"
  | "markRead"
  | "message"
  | "templates"
  | "createTemplate"
  | "updateTemplate"
  | "deleteTemplate"
  | "preview"
  | "send"
  | "events"
  | "createEvent"
  | "removeEvent"
  | "restoreEvent"
>;
