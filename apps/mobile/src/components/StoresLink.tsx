import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Pressable, Text as RNText, View } from "react-native";

import { Card } from "@/components/ui";
import { usePalette } from "@/theme";

/** Entry point on the Today tab for the Stores screen (spending per supermarket). */
export function StoresLink() {
  const router = useRouter();
  const p = usePalette();
  return (
    <Card>
      <Pressable
        onPress={() => router.push("/stores")}
        accessibilityRole="button"
        accessibilityLabel="Where you shop. See what you spend at each supermarket"
        style={{ flexDirection: "row", alignItems: "center", gap: 10 }}
      >
        <MaterialCommunityIcons name="storefront-outline" size={26} color={p.accent} />
        <View style={{ flex: 1 }}>
          <RNText style={{ color: p.text, fontSize: 16, fontWeight: "800" }}>Where you shop</RNText>
          <RNText style={{ color: p.muted, fontSize: 13 }}>What you spend at each supermarket</RNText>
        </View>
        <MaterialCommunityIcons name="chevron-right" size={22} color={p.muted} />
      </Pressable>
    </Card>
  );
}
