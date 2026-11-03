// What the host app (the finance app) provides. The module never reads the app's settings itself.

import type { SdkModule } from "./api/sdk";
import type { MailServerConfig } from "./api/transport";

export type MailHost = {
  /** The server the host already talks to (the mail client lives on the same server and token). */
  server: () => Promise<MailServerConfig | null>;
  /**
   * The Rust SDK (the generated bindings of crates/sdk), when this build has it. The screens then
   * call Rust; without it, or if it cannot load, they use the TypeScript client over HTTP.
   */
  sdk?: SdkModule | null;
  /** Shown as a back button on the first screen. */
  onExit?: () => void;
};
