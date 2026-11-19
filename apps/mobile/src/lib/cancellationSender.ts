/**
 * Sends locally generated cancellation letters. Delivery method is configured
 * at runtime — no credentials are embedded in the app.
 * - email: Expo Mail Composer (user confirms in their mail app), mailto fallback on web
 * - sms: native SMS composer with prefilled text
 * - webhook: POST to a user-provided HTTPS endpoint with optional bearer token
 */
import { Linking, Platform } from "react-native";
import { getConfig, setConfig } from "./secureConfig";
import * as MailComposer from "expo-mail-composer";

const KEYS = { endpoint: "cancel.webhookEndpoint", token: "cancel.webhookToken" } as const;

export type SendMethod = "email" | "sms" | "webhook";
export type CancellationLetter = { to: string; subject: string; html: string };

export async function loadWebhookConfig() {
  const [endpoint, token] = await Promise.all([
    getConfig(KEYS.endpoint),
    getConfig(KEYS.token),
  ]);
  return { endpoint: endpoint ?? "", token: token ?? "" };
}

export async function saveWebhookConfig(endpoint: string, token: string) {
  await setConfig(KEYS.endpoint, endpoint);
  await setConfig(KEYS.token, token);
}

const asText = (html: string) => html.replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

export async function sendCancellation(letter: CancellationLetter, method: SendMethod) {
  if (!letter.to.trim()) throw new Error("Enter the provider address first.");
  if (method === "email") {
    if (Platform.OS !== "web" && await MailComposer.isAvailableAsync()) {
      const result = await MailComposer.composeAsync({
        recipients: [letter.to],
        subject: letter.subject,
        body: asText(letter.html),
        isHtml: false,
      });
      if (result.status !== MailComposer.MailComposerStatus.SENT && result.status !== MailComposer.MailComposerStatus.SAVED) {
        throw new Error("Email was not sent.");
      }
      return "Handed to your mail app for sending.";
    }
    const url = `mailto:${encodeURIComponent(letter.to)}?subject=${encodeURIComponent(letter.subject)}&body=${encodeURIComponent(asText(letter.html))}`;
    await Linking.openURL(url);
    return "Opened your mail app — confirm sending there.";
  }
  if (method === "sms") {
    await Linking.openURL(`sms:${encodeURIComponent(letter.to)}?body=${encodeURIComponent(asText(letter.html).slice(0, 600))}`);
    return "Opened your SMS app — confirm sending there.";
  }
  const { endpoint, token } = await loadWebhookConfig();
  if (!endpoint) throw new Error("Configure an HTTPS webhook endpoint first.");
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(letter),
  });
  if (!response.ok) throw new Error(`Cancellation webhook failed (${response.status}).`);
  return "Cancellation sent through your configured webhook.";
}
