import { useRouter } from "expo-router";
import { Platform } from "react-native";
import { Badge, Box, Button, Card, Icon, IconBadge, Row, Text } from "@financer/ui";

import type { ReweStatus } from "@/api/client";
import { importedText, lastSyncText } from "@/receiptSources";

/**
 * REWE's eBon, read from REWE's web shop in a window of the app (see `rewe-sync`). Unlike the other
 * cards it has no switch and no schedule: receipts are read when you open the window, and if you are
 * still signed in there that happens by itself.
 */
export function ReweCard({ status }: { status: ReweStatus | null }) {
  const router = useRouter();
  const now = Math.floor(Date.now() / 1000);
  const phone = Platform.OS !== "web";
  return (
    <Card gap="md">
      <Row gap="md">
        <IconBadge icon="cart-outline" tone="danger" />
        <Box grow gap="xs">
          <Text variant="heading" level={2}>REWE eBon</Text>
          <Text variant="caption" tone="muted">Read in a window of the app</Text>
          <Row>
            <Badge label="Experimental" tone="warning" icon="flask-outline" />
          </Row>
        </Box>
      </Row>
      <Text variant="body">
        {status && status.receipts > 0
          ? `${importedText(status.receipts)}${status.last_import ? `, last read ${lastSyncText(status.last_import, now).toLowerCase()}` : ""}`
          : "Nothing read yet"}
      </Text>
      <Box gap="sm">
        {[
          "You sign in on REWE's own page, in a window of this app. Financer never sees your password, and no cookie leaves the window.",
          "This is unofficial. REWE has no public interface for this, so it can stop working at any time.",
          "Only receipts you get as an eBon exist (switch it on in the REWE app).",
        ].map((t) => (
          <Row key={t} gap="sm" align="start">
            <Icon name={t.startsWith("This is unofficial") ? "alert-outline" : "check-circle-outline"} size="sm" tone="muted" />
            <Box grow><Text variant="label">{t}</Text></Box>
          </Row>
        ))}
      </Box>
      {phone ? (
        <Button label="Read my REWE receipts" icon="login" onPress={() => router.push("/rewe-sync")} />
      ) : (
        <Text variant="caption" tone="muted">The window is part of the phone app. In a browser use the mailed eBon (Email above).</Text>
      )}
    </Card>
  );
}
