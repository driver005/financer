// The app's own logic lives in Rust (crates/logic) and is called by name: `module.function` with a
// JSON object of arguments, the answer as JSON. Synchronous, because a screen asks while it draws.
// The platform loader (rustSdk.web.ts / rustSdk.native.ts) connects it once the SDK is loaded;
// until then a call is an error that says so.

type LogicFn = (name: string, args: string) => string;

let impl: LogicFn | null = null;

/** Connects the generated binding's `logic` function. Called by the platform loaders (and by tests). */
export function setLogic(fn: LogicFn | null): void {
  impl = fn;
}

export const NOT_READY = "The Rust SDK is not loaded yet (call initSdk() before the screens draw).";

export function logic<T>(name: string, args: Record<string, unknown> = {}): T {
  if (!impl) throw new Error(`${NOT_READY} (${name})`);
  return JSON.parse(impl(name, JSON.stringify(args))) as T;
}
