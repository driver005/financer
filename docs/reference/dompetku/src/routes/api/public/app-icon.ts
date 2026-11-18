import { createFileRoute } from "@tanstack/react-router";
import { withErrorLogging } from "@/lib/monitoring";

// GET /api/public/app-icon — the custom logo from Settings (v14), or a redirect to the
// static /favicon.png. Unauthenticated on purpose: it backs <link rel="icon"> and the login page.
export const Route = createFileRoute("/api/public/app-icon")({
  server: {
    handlers: {
      GET: withErrorLogging("public:app-icon", async ({ request }) => {
        const { getAppSettings } = await import("@/lib/app-settings.server");
        const { parseLogoDataUrl, DEFAULT_ICON } = await import("@/lib/app-settings");
        const logo = parseLogoDataUrl((await getAppSettings()).logo_data);
        if (!logo)
          return new Response(null, {
            status: 302,
            headers: { location: new URL(DEFAULT_ICON, request.url).toString() },
          });
        return new Response(
          Uint8Array.from(atob(logo.base64), (c) => c.charCodeAt(0)),
          {
            headers: {
              "content-type": logo.mime,
              "cache-control": "public, max-age=300",
              "x-content-type-options": "nosniff",
            },
          },
        );
      }),
    },
  },
});
