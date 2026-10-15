// Which backend the app starts on, as plain functions (the provider in config.tsx uses them).

export type BackendMode = "remote" | "embedded";

/**
 * The mode to start in. A build that contains the Rust backend (the "compact" variant) starts in
 * on-phone mode when nothing was ever stored, so skipping the first-run setup does not leave it
 * asking for a server. That default is not a choice: `chosen` is only true when the person (or
 * the setup) saved a mode, because the first-run gate treats "chosen" as "already set up".
 */
export function initialMode(input: {
  storedMode: string | null;
  hasServer: boolean;
  embeddedAvailable: boolean;
}): { mode: BackendMode; chosen: boolean } {
  if (input.storedMode === "embedded") return { mode: "embedded", chosen: true };
  if (input.storedMode === "remote") return { mode: "remote", chosen: true };
  if (input.hasServer) return { mode: "remote", chosen: false };
  return { mode: input.embeddedAvailable ? "embedded" : "remote", chosen: false };
}

/** Whether the first-run setup can be skipped because the app already points somewhere. */
export function isSetUp(input: { hasServer: boolean; mode: BackendMode; chosen: boolean }): boolean {
  return input.hasServer || (input.mode === "embedded" && input.chosen);
}
