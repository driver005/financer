import { ActivityIndicator } from "react-native";

import { type TextTone, useTextColor } from "../primitives/Text";

export function Spinner({ tone = "muted", large }: { tone?: TextTone; large?: boolean }) {
  const color = useTextColor()(tone);
  return <ActivityIndicator color={color} size={large ? "large" : "small"} accessibilityLabel="Loading" />;
}
