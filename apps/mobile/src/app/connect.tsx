import React from "react";
import { Pressable, StyleSheet, Text as RNText, View } from "react-native";
import { useRouter } from "expo-router";
import { FgBankCircle, FgHeaderIcon, FgOnboarding, palette, typography } from "@finance/ui";

/** Connect-accounts onboarding, faithful to the Finanzguru Play Store screenshot. */
export default function ConnectScreen() {
  const router = useRouter();
  return (
    <View style={{ flex: 1, backgroundColor: palette.primary }}>
      <View style={styles.topBar}>
        <FgHeaderIcon name="close" label="Close" onPress={() => router.back()} />
      </View>
      <FgOnboarding title="Connect accounts">
        <View style={styles.circles}>
          <FgBankCircle emoji="S" color="#E30613" size={80} style={{ top: 4, left: "50%", marginLeft: -40 }} />
          <FgBankCircle emoji="S" color="#1CD9B0" size={88} style={{ top: 104, left: 12 }} />
          <FgBankCircle emoji="N26" color="#111111" size={84} style={{ top: 140, right: 8 }} />
          <FgBankCircle emoji="▲" color="#F2A93B" size={82} style={{ top: 242, left: "34%" }} />
          <FgBankCircle emoji="P" color="#0070BA" size={88} style={{ top: 318, right: 6 }} />
          <FgBankCircle emoji="🦁" size={82} style={{ top: 418, left: "28%" }} />
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Connect your bank" onPress={() => router.push("/accounts")} style={styles.cta}>
          <RNText style={[styles.ctaText, { fontFamily: typography.font.display }]}>Connect your bank</RNText>
        </Pressable>
      </FgOnboarding>
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: { position: "absolute", top: 8, right: 12, zIndex: 2 },
  circles: { flex: 1, width: "100%", marginTop: 36 },
  cta: { backgroundColor: "#FFFFFF", borderRadius: 999, paddingHorizontal: 28, paddingVertical: 14, marginBottom: 48 },
  ctaText: { color: palette.primary, fontSize: 16, fontWeight: "700" },
});
