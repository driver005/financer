import {
  Nunito_600SemiBold,
  Nunito_700Bold,
  Nunito_800ExtraBold,
  Nunito_900Black,
} from "@expo-google-fonts/nunito";
import { useFonts } from "expo-font";

/** Loads the four Nunito weights the type scale uses. True once they are ready (or failed: the system font takes over). */
export function useUiFonts(): boolean {
  const [loaded, error] = useFonts({ Nunito_600SemiBold, Nunito_700Bold, Nunito_800ExtraBold, Nunito_900Black });
  return loaded || error !== null;
}
