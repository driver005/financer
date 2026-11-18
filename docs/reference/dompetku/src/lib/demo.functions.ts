import { createServerFn } from "@tanstack/react-start";

/**
 * Public (no login): `{ demo: false }` on normal instances; on a demo instance (DEMO_MODE=true)
 * also the demo login so the login page can offer one-click sign-in.
 */
export const getDemoInfo = createServerFn({ method: "GET" }).handler(async () => {
  const { demoInfo } = await import("./demo.server");
  return demoInfo();
});
