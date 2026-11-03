// The mail client module. See docs/MAIL.md.

export { MailModule } from "./ui/MailModule";
export type { MailHost } from "./host";
export { MailClient, MailApiError } from "./api/client";
export { RemoteMailTransport } from "./api/transport";
export type { MailTransport, MailServerConfig } from "./api/transport";
