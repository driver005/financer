import type { Tone } from "../constants/colors";
import { Box } from "../primitives/Box";
import { Text } from "../primitives/Text";
import { AVATAR_TONES, initialsOf, toneForSeed } from "./avatarModel";

export { AVATAR_TONES, initialsOf, toneForSeed };

export type AvatarProps = {
  /** The person's name, or their address when no name is known. */
  name: string;
  size?: "sm" | "md" | "lg";
  /** A fixed tone; otherwise one is chosen from the name, always the same for the same name. */
  tone?: Tone;
};

/** A person as a circle with their initials, soft-coloured so a chat list is easy to scan. */
export function Avatar({ name, size = "md", tone }: AvatarProps) {
  const t = tone ?? toneForSeed(name);
  return (
    <Box dim={`avatar-${size}`} radius="full" bg={`${t}-soft`} align="center" justify="center" shrink={false} accessibilityLabel={name} accessibilityRole="image">
      <Text variant={size === "sm" ? "badge" : "label"} tone={`on-${t}-soft`}>
        {initialsOf(name)}
      </Text>
    </Box>
  );
}
