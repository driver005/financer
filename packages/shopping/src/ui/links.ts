import { Linking } from "react-native";

import { safeUrl } from "../logic/format";

/** Open a link from a shop page, if it is a web address. */
export async function openLink(url: string): Promise<void> {
  const safe = safeUrl(url);
  if (safe) await Linking.openURL(safe);
}
