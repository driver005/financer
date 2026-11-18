import React, { useEffect, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { Button, Card, IconButton, Note, Screen, SectionTitle, Segmented, Text, TextField } from "../ui/primitives";
import { tokens } from "../ui/theme";
import { getSetting, setSetting } from "../db/database";
import { clearAllData } from "../db/money";
import { core } from "../rust/core";
import { clearSamplePrices } from "../db/prices";
import { EMPTY_BANK_CONFIG, type BankConfig } from "../lib/bank";

export default function SettingsScreen() {
  const router = useRouter();
  const [config, setConfig] = useState<BankConfig>(EMPTY_BANK_CONFIG);
  const [saved, setSaved] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [startDay, setStartDay] = useState("1");
  const [pin, setPin] = useState("");
  const [pinMessage, setPinMessage] = useState<string | null>(null);

  useEffect(() => {
    void getSetting("startDay").then((value) => { if (value) setStartDay(value); });
    void getSetting("bankConfig").then((raw) => {
      if (raw) setConfig({ ...EMPTY_BANK_CONFIG, ...(JSON.parse(raw) as Partial<BankConfig>) });
    });
  }, []);

  const update = (key: keyof BankConfig, value: string) => {
    setSaved(false);
    setConfig((prev) => ({ ...prev, [key]: value }));
  };

  const save = async () => {
    await setSetting("bankConfig", JSON.stringify(config));
    setSaved(true);
  };

  return (
    <Screen
      title="Settings"
      subtitle="Everything on this device"
      back={<IconButton icon="arrow-left" label="Back" onPress={() => router.back()} />}
    >
      <Card>
        <SectionTitle>Plaid</SectionTitle>
        <Note>Connect straight from the phone. Connection uses the network; the transactions and keys are kept only in this app's local database.</Note>
        <TextField label="Client ID" value={config.plaidClientId} onChangeText={(v) => update("plaidClientId", v)} />
        <TextField label="Secret" value={config.plaidSecret} onChangeText={(v) => update("plaidSecret", v)} />
        <TextField label="Access token" value={config.plaidAccessToken} onChangeText={(v) => update("plaidAccessToken", v)} />
        <Segmented
          value={config.plaidEnv}
          onChange={(v) => update("plaidEnv", v)}
          options={[{ value: "sandbox", label: "Sandbox" }, { value: "development", label: "Dev" }, { value: "production", label: "Live" }]}
        />
      </Card>

      <Card>
        <SectionTitle>GoCardless / other provider</SectionTitle>
        <TextField label="Access token" value={config.gocardlessToken} onChangeText={(v) => update("gocardlessToken", v)} />
        <TextField label="Account ID" value={config.gocardlessAccount} onChangeText={(v) => update("gocardlessAccount", v)} />
      </Card>

      <Card>
        <SectionTitle>Start of month</SectionTitle>
        <Text color="muted">A payday start day (1-28) shifts monthly totals and budgets to run from this day to the day before it next month.</Text>
        <TextField label="Start day" value={startDay} onChangeText={setStartDay} keyboardType="number-pad" />
        <Button label="Save start day" icon="calendar" onPress={() => void setSetting("startDay", startDay).then(() => setPinMessage("Start day saved."))} />
      </Card>

      <Card>
        <SectionTitle>App lock</SectionTitle>
        <Text color="muted">A local passcode locks the app on every start. The code is stored as a hash on this device.</Text>
        <TextField label="New passcode" value={pin} onChangeText={setPin} keyboardType="number-pad" placeholder="4+ digits" />
        <Button label="Set passcode" icon="lock" onPress={() => void setSetting("passcodeHash", core.pinHash(pin)).then(() => { setPin(""); setPinMessage("Passcode saved."); })} disabled={pin.length < 4} />
        <Button label="Remove passcode" tone="secondary" onPress={() => void setSetting("passcodeHash", "").then(() => setPinMessage("Passcode removed."))} />
        {pinMessage ? <Note tone="success">{pinMessage}</Note> : null}
      </Card>

      <Card>
        <SectionTitle>Prices</SectionTitle>
        <Text color="muted">Price curves start with local sample prices so you can see the comparison. Add your own prices on any item, then remove the samples.</Text>
        <Button label="Remove sample prices" tone="secondary" icon="delete-sweep" onPress={() => void clearSamplePrices()} />
      </Card>

      <Card>
        <SectionTitle>Local data</SectionTitle>
        <Text color="muted">Recipes, saved favourites, shopping lists, Angebote and transactions never leave the device. There is no account, token or server.</Text>
        {confirmClear ? (
          <View style={styles.row}>
            <Button label="Yes, erase everything" tone="danger" onPress={() => void clearAllData().then(() => setConfirmClear(false))} />
            <Button label="Cancel" tone="secondary" onPress={() => setConfirmClear(false)} />
          </View>
        ) : (
          <Button label="Erase all local data" tone="danger" onPress={() => setConfirmClear(true)} />
        )}
      </Card>

      <Button label={saved ? "Saved" : "Save provider settings"} icon="content-save" onPress={() => void save()} disabled={saved} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: tokens.sm, flexWrap: "wrap" },
});
