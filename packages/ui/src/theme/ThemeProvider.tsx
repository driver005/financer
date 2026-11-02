import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useColorScheme } from "react-native";

import { colorsByScheme, type Scheme, type ThemeColors } from "../constants/colors";
import { type Shadow, shadowsByScheme } from "../constants/shadows";

export type SchemeSetting = Scheme | "system";

export type Theme = { scheme: Scheme; colors: ThemeColors; shadows: Record<Shadow, string> };

const Ctx = createContext<Theme | null>(null);

/** Gives every component its colours. `scheme` follows the system unless the app fixes it. */
export function ThemeProvider({ scheme = "system", children }: { scheme?: SchemeSetting; children: ReactNode }) {
  const system = useColorScheme();
  const active: Scheme = scheme === "system" ? (system === "dark" ? "dark" : "light") : scheme;
  const value = useMemo<Theme>(() => ({ scheme: active, colors: colorsByScheme[active], shadows: shadowsByScheme[active] }), [active]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme(): Theme {
  const v = useContext(Ctx);
  if (!v) throw new Error("UI components must be inside <ThemeProvider>");
  return v;
}

export function useColors(): ThemeColors {
  return useTheme().colors;
}
