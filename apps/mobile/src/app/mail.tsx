import { MailEntry } from "@/mail/MailEntry";

// The mail client is a tab of the app: the app's own tab bar is around it, so it draws no bar of its own.
export default function MailRoute() {
  return <MailEntry />;
}
