import { type ReactNode, useEffect } from "react";

import { Banner } from "./Banner";

/** A short message that goes away by itself. Put it at the end of the page (in a `Screen` footer or last in the content). */
export function Snackbar({ visible, onDismiss, seconds = 4, tone = "success", children }: { visible: boolean; onDismiss: () => void; seconds?: number; tone?: "success" | "danger" | "info"; children: ReactNode }) {
  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(onDismiss, seconds * 1000);
    return () => clearTimeout(t);
  }, [visible, onDismiss, seconds]);
  return visible ? <Banner tone={tone}>{children}</Banner> : null;
}
