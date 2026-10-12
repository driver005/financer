import { useEffect } from "react";
import { AppState, Platform } from "react-native";

import { useApi } from "@/api/config";
import { runAutoBackupIfDue } from "@/native/backup";

/**
 * Makes the automatic backup (if switched on and due) when the app opens and whenever it comes
 * back to the front. Renders nothing. A failure is only logged, without any secrets: the Backup
 * card in Settings shows the state, and an old backup is the visible symptom.
 */
export function BackupOnOpen() {
  const { api } = useApi();

  useEffect(() => {
    if (!api || Platform.OS === "web") return;
    const run = () => {
      void runAutoBackupIfDue(api).then((r) => {
        if (r.status === "failed") console.warn("Automatic backup failed:", r.message);
      });
    };
    run();
    const sub = AppState.addEventListener("change", (s) => s === "active" && run());
    return () => sub.remove();
  }, [api]);

  return null;
}
