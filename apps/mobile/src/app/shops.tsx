import React, { useCallback, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { Badge, Button, Card, Empty, IconButton, Loading, Note, Screen, SectionTitle, Text, TextField } from "../ui/primitives";
import { tokens, useTheme } from "../ui/theme";
import { autoMatchStores, getStores, offers, saveOffers, saveStore, deleteOffer, transactions, setTransactionStore } from "../db/money";
import { purchases, savePurchases, deletePurchase, type Purchase } from "../db/purchases";
import { STORE_SYNCS, type StoreSync } from "../lib/stores";
import { core } from "../rust/core";
import type { Offer, Store, Transaction } from "../lib/types";

export default function ShopsScreen() {
  const { colors } = useTheme();
  const [stores, setStores] = useState<Store[]>([]);
  const [rows, setRows] = useState<Transaction[]>([]);
  const [offersList, setOffersList] = useState<Offer[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [aliasText, setAliasText] = useState("");
  const [offerStore, setOfferStore] = useState("rewe");
  const [paste, setPaste] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [bought, setBought] = useState<Purchase[]>([]);
  const [buyText, setBuyText] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    const [s, t, o, b] = await Promise.all([getStores(), transactions(core.monthKey(new Date())), offers(), purchases()]);
    setStores(s);
    setRows(t);
    setOffersList(o);
    setBought(b);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const runMatch = useCallback(async () => {
    const matched = await autoMatchStores();
    setMessage(matched ? `Matched ${matched} transactions to a shop.` : "No new transactions matched.");
    await load();
  }, [load]);

  const importOffers = useCallback(async () => {
    const parsed = core.parseOffers(paste, offerStore);
    if (!parsed.length) { setMessage("No offers found. Use lines like: Milk 1,29 €"); return; }
    await saveOffers(parsed as unknown as Offer[]);
    setPaste("");
    setMessage(`Saved ${parsed.length} Angebote.`);
    await load();
  }, [paste, offerStore, load]);

  const importBought = useCallback(async (storeId: string) => {
    const text = buyText[storeId] ?? "";
    const parsed = core.parsePurchases(text, storeId);
    if (!parsed.length) { setMessage("Type at least one item you buy at this brand."); return; }
    const count = await savePurchases(parsed);
    setBuyText((prev) => ({ ...prev, [storeId]: "" }));
    setMessage(`Saved ${count} items you buy at ${stores.find((s) => s.id === storeId)?.name ?? storeId}.`);
    await load();
  }, [buyText, stores, load]);

  const assigned = rows.filter((t) => t.storeId).length;

  return (
    <Screen
      title="Shops"
      subtitle="REWE · Kaufland · Lidl · Aldi · Penny · Netto"
      action={<IconButton icon="refresh" label="Reload" onPress={() => void load()} />}
    >
      {message ? <Note tone="success">{message}</Note> : null}
      <Card>
        <SectionTitle>Transaction matching</SectionTitle>
        <Text color="muted">{assigned} of {rows.length} transactions this month are assigned to a shop.</Text>
        <Button label="Match transactions" icon="link" onPress={() => void runMatch()} />
        <Text variant="caption" color="subtle">Uses each shop's spellings. Edit them below to improve matching.</Text>
      </Card>

      <SectionTitle>Supermarket sync</SectionTitle>
      {loading ? <Loading rows={4} /> : null}
      {STORE_SYNCS.map((sync: StoreSync) => {
        const store = stores.find((s) => s.id === sync.id);
        const summary = core.storeSummary(rows, sync.id);
        const unassigned = rows.filter((t) => !t.storeId).length;
        return (
          <Card key={sync.id}>
            <View style={styles.row}>
              <View style={styles.grow}>
                <Text variant="subheading">{sync.name}</Text>
                <Text variant="caption" color="muted">{sync.note}</Text>
                <View style={styles.badges}>
                  <Badge label={`${summary.visits} visits`} />
                  <Badge label={`€${(summary.total / 100).toFixed(2)} this month`} />
                  {summary.visits ? <Badge label={`avg €${(summary.average / 100).toFixed(2)}`} /> : null}
                </View>
              </View>
              <IconButton icon="pencil" label={`Edit ${sync.name} spellings`} onPress={() => { setEditing(sync.id); setAliasText(store?.aliases ?? ""); }} />
            </View>
            {unassigned > 0 ? (
              <View style={styles.unassigned}>
                {rows.filter((t) => !t.storeId).slice(0, 4).map((t) => (
                  <View key={t.id} style={styles.row}>
                    <Text variant="caption" style={styles.flex}>{t.merchant}</Text>
                    <Button label={sync.name} tone="secondary" onPress={() => void setTransactionStore(t.id, sync.id).then(load)} />
                  </View>
                ))}
              </View>
            ) : null}
            {editing === sync.id ? (
              <View style={styles.editor}>
                <TextField label={`${sync.name} spellings (comma separated)`} value={aliasText} onChangeText={setAliasText} />
                <View style={styles.row}>
                  <Button label="Save" onPress={() => void saveStore({ id: sync.id, name: sync.name, aliases: aliasText, active: 1 }).then(() => { setEditing(null); void load(); })} />
                  <Button label="Cancel" tone="secondary" onPress={() => setEditing(null)} />
                </View>
              </View>
            ) : null}
            <View style={[styles.bought, { borderTopColor: colors.border }]}>
              <Text variant="caption" color="muted">What I buy here — one item per line, optional number for amount.</Text>
              <TextField
                label={`Items at ${sync.name}`}
                value={buyText[sync.id] ?? ""}
                onChangeText={(value) => setBuyText((prev) => ({ ...prev, [sync.id]: value }))}
                multiline
                placeholder={"Milk 2\nBread\nEggs 1"}
              />
              <Button label={`Save items at ${sync.name}`} icon="plus" onPress={() => void importBought(sync.id)} disabled={!(buyText[sync.id] ?? "").trim()} />
              {bought.filter((item) => item.storeId === sync.id).map((item) => (
                <View key={item.id} style={styles.row}>
                  <Text variant="caption" style={styles.flex}>{`${item.name} ×${item.qty}`}</Text>
                  <IconButton icon="close" label={`Remove ${item.name}`} onPress={() => void deletePurchase(item.id).then(load)} />
                </View>
              ))}
            </View>
          </Card>
        );
      })}

      <SectionTitle>Angebote (special offers)</SectionTitle>
      <Card>
        <Text variant="caption" color="muted">Paste an offer list from a shop app or type it yourself. Everything is saved locally.</Text>
        <View style={styles.storeRow}>
          {stores.map((s) => (
            <Badge key={s.id} label={s.name} tone={offerStore === s.id ? "accent" : undefined} />
          ))}
        </View>
        <TextField label="Shop for these offers" value={offerStore} onChangeText={setOfferStore} />
        <TextField label="Offers, one per line" value={paste} onChangeText={setPaste} multiline placeholder={"Milch 1,29 €\nJoghurt 0,99"} />
        <Button label="Save Angebote" icon="tag" onPress={() => void importOffers()} disabled={!paste.trim()} />
      </Card>
      {offersList.length ? (
        <Card>
          {offersList.map((offer) => (
            <View key={offer.id} style={styles.row}>
              <View style={styles.grow}>
                <Text>{offer.product}</Text>
                <Text variant="caption" color="muted">{stores.find((s) => s.id === offer.storeId)?.name ?? offer.storeId} · {offer.price} · until {offer.validTo}</Text>
              </View>
              <IconButton icon="trash-can-outline" label={`Delete ${offer.product}`} onPress={() => void deleteOffer(offer.id).then(load)} />
            </View>
          ))}
        </Card>
      ) : (
        <Empty icon="tag-outline" title="No Angebote yet" message="Paste a shop's offer list above to compare it with your shopping list." />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: tokens.sm },
  grow: { flex: 1, gap: 4 },
  flex: { flex: 1 },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: tokens.xs },
  unassigned: { gap: tokens.sm, paddingTop: tokens.sm, borderTopWidth: 1, borderTopColor: "#E4E4E7" },
  editor: { gap: tokens.sm, paddingTop: tokens.sm },
  bought: { gap: tokens.sm, paddingTop: tokens.sm, borderTopWidth: 1 },
  storeRow: { flexDirection: "row", flexWrap: "wrap", gap: tokens.xs },
});
