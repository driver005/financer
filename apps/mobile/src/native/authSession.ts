import * as Linking from "expo-linking";
import { Platform } from "react-native";

import { signInMode } from "@/receiptSources";

/** Result of sending the person to a retailer's sign-in page. */
export type SignInPageResult =
  /** The page redirected to the app's callback and the address came back. */
  | { kind: "callback"; url: string }
  /** The person closed the sheet before finishing. */
  | { kind: "cancelled" }
  /** The page was opened in a normal browser; the address has to be pasted back by hand. */
  | { kind: "opened" };

/** The part of `expo-web-browser` used here. */
type WebBrowserLike = {
  openAuthSessionAsync(url: string, redirectUrl?: string | null): Promise<{ type: string; url?: string }>;
};

/**
 * Open a sign-in page the retailer hosts. On iOS and Android this is an authentication session
 * (ASWebAuthenticationSession / a custom tab) that hands the redirect address back to the app;
 * on the web and on desktop a custom-scheme redirect cannot be intercepted, so the page is just
 * opened and the caller asks the person to paste the address.
 *
 * `expo-web-browser` is loaded only on phones, so the web bundle does not need it.
 */
export async function openSignInPage(url: string, redirectUri: string): Promise<SignInPageResult> {
  if (signInMode(Platform.OS) === "auth-session") {
    const WebBrowser = require("expo-web-browser") as WebBrowserLike;
    const result = await WebBrowser.openAuthSessionAsync(url, redirectUri);
    if (result.type === "success" && result.url) return { kind: "callback", url: result.url };
    return { kind: "cancelled" };
  }
  await Linking.openURL(url);
  return { kind: "opened" };
}

/** Open the sign-in page in a normal browser (the paste route). Needs a tap to be allowed to open on the web. */
export async function openInBrowser(url: string): Promise<void> {
  await Linking.openURL(url);
}
