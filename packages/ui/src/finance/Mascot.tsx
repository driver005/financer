import { useEffect, useRef } from "react";
import { Animated, Easing, View } from "react-native";

import { duration } from "../constants/misc";
import { radius } from "../constants/radius";
import { size } from "../constants/sizes";
import { space } from "../constants/spacing";
import { Box, Row } from "../primitives/Box";
import { Text } from "../primitives/Text";
import { useTheme } from "../theme/ThemeProvider";

export type Mood = "happy" | "cheer" | "worried";

const BADGE: Record<Mood, string | null> = { happy: null, cheer: "\u{1F389}", worried: "\u{1F4A6}" };

/**
 * Penny the piggy bank's face: a round accent badge with the pig. It bobs gently and reacts to `mood`.
 * The emoji is game content (the mascot), never an interface icon.
 */
export function MascotFace({ mood = "happy", big }: { mood?: Mood; big?: boolean }) {
  const { colors } = useTheme();
  const y = useRef(new Animated.Value(0)).current;
  const d = big ? size.avatar.xl : size.avatar.lg;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(y, { toValue: -space.xs, duration: duration.slower, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(y, { toValue: 0, duration: duration.slower, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [y]);
  const badge = BADGE[mood];
  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: d, height: d, borderRadius: radius.full, backgroundColor: colors.tones.accent.soft, alignItems: "center", justifyContent: "center", transform: [{ translateY: y }] }}
    >
      <Text variant={big ? "display" : "title"}>{"\u{1F437}"}</Text>
      {badge ? (
        <View style={{ position: "absolute", top: -space.xs, right: -space.xs }}>
          <Text variant="subheading">{badge}</Text>
        </View>
      ) : null}
    </Animated.View>
  );
}

/** Penny talks in a speech bubble. */
export function Mascot({ message, mood = "happy" }: { message: string; mood?: Mood }) {
  return (
    <Row gap="md">
      <MascotFace mood={mood} />
      <Box grow bg="surface" radius="2xl" border="hairline" py="md" px="lg" accessibilityRole="text">
        <Text variant="bodyStrong">{message}</Text>
      </Box>
    </Row>
  );
}
