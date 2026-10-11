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
    background: "#f6fbf6",
    surface: "#f6fbf6",
    error: "#ba1a1a",
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
    background: "#0f1512",
    surface: "#0f1512",
    error: "#ffb4ab",
  },
};

export const themes = { light, dark };
