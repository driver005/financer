import { useState } from "react";
import { Image } from "react-native";

import { radius as radii, type Radius } from "../constants/radius";
import { type Dim, dimValue } from "../primitives/box";
import { Box } from "../primitives/Box";
import { Icon, type IconName } from "../primitives/Icon";

/** A picture at a token size, with an icon in its place when there is none or it fails to load. */
export function Thumbnail({ uri, dim = "thumb-md", fill, radius = "lg", fallback = "image-outline", fit = "contain", label }: { uri?: string | null; dim?: Dim; /** Fill the width of the parent as a square instead of a fixed size. */ fill?: boolean; radius?: Radius; fallback?: IconName; fit?: "cover" | "contain"; label?: string }) {
  const [failed, setFailed] = useState(false);
  const d = dimValue(dim);
  return (
    <Box dim={fill ? undefined : dim} full={fill} square={fill} radius={radius} bg="sunken" overflow="hidden" align="center" justify="center" accessibilityLabel={label} accessibilityRole={label ? "image" : undefined}>
      {uri && !failed ? (
        <Image source={{ uri }} onError={() => setFailed(true)} resizeMode={fit} style={fill ? { width: "100%", height: "100%" } : { width: d, height: d, borderRadius: radii[radius] }} accessibilityIgnoresInvertColors />
      ) : (
        <Icon name={fallback} size="lg" tone="subtle" />
      )}
    </Box>
  );
}
