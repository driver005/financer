import { useEffect } from "react";
import { useRouter, type ErrorComponentProps } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { reportLovableError } from "@/lib/lovable-error-reporting";

export function RouteError({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  useEffect(() => {
    // Client-side route/loader error: structured console line (visible in the browser console
    // and Lovable's runtime log). Server-side failures are logged by monitoring.server.ts.
    console.error(
      JSON.stringify({
        level: "error",
        scope: "client:route",
        message: error instanceof Error ? error.message : String(error),
        path: typeof window !== "undefined" ? window.location.pathname : undefined,
        timestamp: new Date().toISOString(),
      }),
      error,
    );
    reportLovableError(error, { boundary: "route_error_component" });
  }, [error]);
  return (
    <div className="mx-auto max-w-lg rounded-2xl border bg-card p-8 text-center">
      <h2 className="text-xl font-semibold">Data gagal dimuat</h2>
      <p className="mt-2 text-sm text-muted-foreground break-words">
        {error instanceof Error ? error.message : String(error)}
      </p>
      <p className="mt-2 text-xs text-muted-foreground">
        Pastikan environment Supabase sudah diatur dan schema SQL sudah dijalankan.
      </p>
      <Button
        className="mt-5"
        onClick={() => {
          router.invalidate();
          reset();
        }}
      >
        Coba lagi
      </Button>
    </div>
  );
}
