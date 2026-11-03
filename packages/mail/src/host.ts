// What the host app (the finance app) provides. The module never reads the app's settings itself.

import type { MailServerConfig } from "./api/transport";

export type MailHost = {
  /** The server the host already talks to (the mail client lives on the same server and token). */
  server: () => Promise<MailServerConfig | null>;
  /** Shown as a back button on the first screen. */
  onExit?: () => void;
};
