import { useColorScheme } from "react-native";

const space = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, hero: 48 };

/** Inspired by Dribbble shots Foody (SLAB), Bodega (Ipanadh) and Meto (V. Labici). */
export const tokens = {
  ...space,
  space,
  radius: { sm: 14, md: 20, card: 24, lg: 24, pill: 999 },
  font: { caption: 11, label: 13, body: 14, subheading: 19, title: 28, number: 36 },
  serif: "Fraunces",
  sans: "Plus Jakarta Sans",
  minTouch: 46,
};

const light = {
  bg: "#F4F6F3",
  surface: "#FFFFFF",
  surfaceMuted: "#EDF3ED",
  text: "#171A17",
  muted: "#6B746B",
  subtle: "#8B948B",
  border: "#E2E8E1",
  accent: "#2F7D5D",
  accentHover: "#256A4E",
  accentText: "#FFFFFF",
  accentSoft: "#E5F1E9",
  offer: "#E2563B",
  offerSoft: "#FDECE7",
  danger: "#C8423B",
  success: "#2F7D5D",
  skeleton: "#E2E8E1",
};

const dark: typeof light = {
  bg: "#101612",
  surface: "#1A231D",
  surfaceMuted: "#233029",
  text: "#F7FAF7",
  muted: "#AFC0B3",
  subtle: "#8FA392",
  border: "#2E3D33",
  accent: "#74C79C",
  accentHover: "#93DBAE",
  accentText: "#101612",
  accentSoft: "#203D2D",
  offer: "#FF9A82",
  offerSoft: "#3A2622",
  danger: "#FF9A82",
  success: "#74C79C",
  skeleton: "#2E3D33",
};

export type Colors = typeof light;

export function useTheme(): { colors: Colors; dark: boolean } {
  const scheme = useColorScheme();
  return { colors: scheme === "dark" ? dark : light, dark: scheme === "dark" };
}
