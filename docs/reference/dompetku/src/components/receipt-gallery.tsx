import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ExternalLink } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getReceiptUrl } from "@/lib/finance.functions";
import { useI18n } from "@/lib/i18n";

/** Loads short-lived signed URLs for receipt paths (one request per path). */
export function useReceiptUrls(paths: string[]) {
  const sign = useServerFn(getReceiptUrl);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const key = paths.join("|");
  useEffect(() => {
    let alive = true;
    for (const p of paths) {
      if (urls[p]) continue;
      sign({ data: { path: p } })
        .then(({ url }) => alive && setUrls((u) => ({ ...u, [p]: url })))
        .catch(() => undefined);
    }
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return urls;
}

/** Small gallery dialog for all photos of one transaction. */
export function ReceiptGallery({
  paths,
  onOpenChange,
}: {
  paths: string[];
  onOpenChange: (o: boolean) => void;
}) {
  const { t } = useI18n();
  const urls = useReceiptUrls(paths);
  return (
    <Dialog open={paths.length > 0} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-1.5rem)] w-[calc(100vw-1.5rem)] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("Foto nota")}</DialogTitle>
          <DialogDescription>
            {paths.length} {t("foto · tautan berlaku 5 menit")}
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {paths.map((p, i) => (
            <figure key={p} className="min-w-0 overflow-hidden rounded-lg border bg-muted/50">
              {urls[p] ? (
                <a href={urls[p]} target="_blank" rel="noopener noreferrer">
                  <img
                    src={urls[p]}
                    alt={`${t("Foto nota")} ${i + 1}`}
                    className="max-h-[60dvh] w-full object-contain"
                  />
                </a>
              ) : (
                <div className="flex h-40 items-center justify-center text-xs text-muted-foreground">
                  {t("Memuat…")}
                </div>
              )}
              {urls[p] ? (
                <figcaption className="flex justify-end p-1.5">
                  <a
                    href={urls[p]}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    <ExternalLink className="size-3" /> {t("Buka")}
                  </a>
                </figcaption>
              ) : null}
            </figure>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
