// What the host app (the finance app) provides. The module never reads the app's settings itself.

import type { Caller } from "../../wire/src";

/** Where a server is and the token it accepts. */
export type MailServerConfig = { baseUrl: string; token: string };

export type MailHost = {
  /** The server the host already talks to (the mail client lives on the same server and token). */
  server: () => Promise<MailServerConfig | null>;
  /** The mail API of a server, called through the Rust SDK (docs/SDK.md). The host makes it. */
  makeCaller: (config: MailServerConfig) => Promise<Caller>;
  /** Shown as a back button on the first screen. */
  onExit?: () => void;
  /**
   * The host puts the module in one of its own tabs: no bottom bar or rail of its own (the host's
   * stands in for it) and the theme of the host. Calendar, Templates and Mailbox are then reached
   * from the menu of the chat list, each with a back button to the chats.
   */
  embedded?: boolean;
};
