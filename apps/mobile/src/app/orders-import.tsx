import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Banner, Box, Button, Card, Stack, Text, TextField } from "@financer/ui";

import { BATCH, previewText, readOrders, type OrderFile } from "@/orderCsv";
import { useApi } from "@/api/config";
import { Page } from "@/components/Page";
import { NeedsSetup } from "@/components/Status";
import { pickTextFile } from "@/native/files";
import { runText } from "@/reweSync";
import { takeCsv } from "@/shareImport";

/**
 * Online orders from a file the shop produced: Amazon's "request your data" gives the order history
 * as a CSV. Pick it, check what was found, import. Nothing is fetched from the shop; the file is
 * read on this device and the orders go to your server.
 */
export default function OrdersImport() {
  const { api, loaded } = useApi();
  const router = useRouter();
  const [file, setFile] = useState<OrderFile | null>(null);
  const [shop, setShop] = useState("");
  const [message, setMessage] = useState<{ tone: "info" | "danger" | "success"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // a CSV shared to Financer from another app waits here
  useEffect(() => {
    const held = takeCsv();
    if (!held) return;
    const r = readOrders(held.text);
    if (!r.ok) {
      setMessage({ tone: "danger", text: r.reason });
      return;
    }
    setFile(r.file);
    setShop(r.file.shop ?? "");
    setMessage({ tone: "info", text: `${held.name}: ${previewText(r.file)}` });
  }, []);

  if (loaded && !api) {
    return (
      <Page title="Online orders">
        <NeedsSetup />
      </Page>
    );
  }

  async function pick() {
    try {
      const text = await pickTextFile(["text/csv", "text/comma-separated-values", "text/plain", "application/vnd.ms-excel", "*/*"]);
      if (text === null) return;
      const r = readOrders(text);
      if (!r.ok) {
        setFile(null);
        setMessage({ tone: "danger", text: r.reason });
        return;
      }
      setFile(r.file);
      setShop(r.file.shop ?? "");
      setMessage(r.file.orders.length === 0 ? { tone: "danger", text: `No order could be used. ${previewText(r.file)}` } : { tone: "info", text: previewText(r.file) });
    } catch (e) {
      setMessage({ tone: "danger", text: e instanceof Error ? e.message : "Could not read the file." });
    }
  }

  async function run() {
    if (!api || !file || !shop.trim()) return;
    setBusy(true);
    try {
      const total = { imported: 0, duplicates: 0, skipped: 0, linked: 0 };
      for (let i = 0; i < file.orders.length; i += BATCH) {
        const r = await api.ordersImport(shop.trim(), file.orders.slice(i, i + BATCH));
        total.imported += r.imported;
        total.duplicates += r.duplicates;
        total.skipped += r.skipped;
        total.linked += r.linked;
      }
      setFile(null);
      setMessage({ tone: "success", text: runText(total, 0).replace("receipt", "order") });
    } catch (e) {
      setMessage({ tone: "danger", text: e instanceof Error ? e.message : "The import failed." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page title="Online orders" subtitle="Amazon and other shops, from a file">
      <Stack gap="lg">
        {message ? <Banner tone={message.tone}>{message.text}</Banner> : null}
        <Card gap="md">
          <Text variant="heading" level={2}>Order history file</Text>
          <Text variant="body" tone="muted">
            Amazon: in your account open "Request your data", ask for "Your Orders" and wait for the mail (a few days to about a month); unpack the download and pick the file `Retail.OrderHistory` (a .csv). Other shops: any order list as a CSV with an order number, a date, a product and an amount.
          </Text>
          <Button label={file ? "Pick another file" : "Pick the CSV file"} icon="file-delimited-outline" variant={file ? "outline" : "solid"} onPress={() => void pick()} disabled={busy} />
        </Card>
        {file && file.orders.length > 0 ? (
          <Card gap="md">
            <Text variant="bodyStrong">Check, then import</Text>
            <TextField label="Shop name" value={shop} onChangeText={setShop} placeholder="Amazon" maxLength={40} />
            <Text variant="caption" tone="muted">The orders are stored as receipts of this shop (once each; importing the same file again adds nothing) and matched to your bank payments.</Text>
            <Button label={busy ? "Importing…" : `Import ${file.orders.length} order${file.orders.length === 1 ? "" : "s"}`} icon="check" onPress={() => void run()} disabled={busy || !shop.trim()} />
          </Card>
        ) : null}
        <Box>
          <Button label="Back to receipt sources" variant="ghost" onPress={() => (router.canGoBack() ? router.back() : router.replace("/receipt-sources"))} />
        </Box>
      </Stack>
    </Page>
  );
}
