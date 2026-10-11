import { MD3DarkTheme, MD3LightTheme, type MD3Theme } from "react-native-paper";

// A calm green seed colour: money-positive without looking like a casino.
const light: MD3Theme = {
  ...MD3LightTheme,
  colors: {
    ...MD3LightTheme.colors,
    primary: "#1b6b4a",
    onPrimary: "#ffffff",
    primaryContainer: "#b7f1d1",
    onPrimaryContainer: "#002113",
    secondary: "#4d6357",
    secondaryContainer: "#cfe9d9",
    onSecondaryContainer: "#0a1f14",
    background: "#f6fbf6",
    surface: "#f6fbf6",
    surfaceVariant: "#dbe5dd",
    onSurfaceVariant: "#404943",
    outline: "#707973",
    outlineVariant: "#bfc9c1",
    error: "#ba1a1a",
    elevation: { level0: "transparent", level1: "#eef5ee", level2: "#e8f0e9", level3: "#e2ebe3", level4: "#e0e9e1", level5: "#dce6de" },
  },
};

const dark: MD3Theme = {
  ...MD3DarkTheme,
  colors: {
    ...MD3DarkTheme.colors,
    primary: "#9bd4b5",
    onPrimary: "#003824",
    primaryContainer: "#00513a",
    onPrimaryContainer: "#b7f1d1",
    secondary: "#b3ccbc",
    secondaryContainer: "#354b3d",
    onSecondaryContainer: "#cfe9d9",
    background: "#0f1512",
    surface: "#0f1512",
    surfaceVariant: "#404943",
    onSurfaceVariant: "#bfc9c1",
    outline: "#8a938c",
    outlineVariant: "#404943",
    error: "#ffb4ab",
    elevation: { level0: "transparent", level1: "#17201b", level2: "#1b251f", level3: "#1f2a23", level4: "#212c25", level5: "#242f28" },
  },
};

export const themes = { light, dark };
