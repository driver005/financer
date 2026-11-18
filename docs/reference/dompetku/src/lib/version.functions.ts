import { createServerFn } from "@tanstack/react-start";

/** Public (no login): latest GitHub release vs the running version, or null when unknown. */
export const getLatestRelease = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const { latestRelease } = await import("./version.server");
    return await latestRelease();
  } catch {
    return null;
  }
});
