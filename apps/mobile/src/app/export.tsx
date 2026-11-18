import React, { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text as RNText } from "react-native";
import { useRouter } from "expo-router";
import { Card, IconButton, Screen, Text } from "../ui/primitives";
import { allTransactions } from "../db/moneyTracker";
import { core } from "../rust/core";
import { tokens, useTheme } from "../ui/theme";

export default function ExportScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const [csv, setCsv] = useState("");

  useEffect(() => {
    void allTransactions().then((rows) => setCsv(core.csvExport(rows)));
  }, []);

  return (
    <Screen title="Export CSV" subtitle="Your data, copied out of the local app" back={<IconButton icon="arrow-left" label="Back" onPress={() => router.back()} />}>
      <Card>
        <Text variant="caption" color="muted">date;merchant;amount;category;kind;account</Text>
      </Card>
      <ScrollView style={[styles.box, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <RNText selectable style={[styles.text, { color: colors.text }]}>{csv || "No transactions yet."}</RNText>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  box: { flex: 1, minHeight: 400, borderWidth: 1, borderRadius: tokens.radius.card, padding: tokens.md },
  text: { fontFamily: "monospace", fontSize: 11, lineHeight: 17 },
});
