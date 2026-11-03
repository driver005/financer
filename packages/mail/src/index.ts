// The mail client module. See docs/MAIL.md.

export { MailModule } from "./ui/MailModule";
export type { MailHost } from "./host";
export { MailClient, MailApiError, mailCaller } from "./api/client";
export type { MailServerConfig } from "./host";
