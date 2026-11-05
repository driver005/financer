# Mail

A mail client that reads like a chat. Mail from one person is one conversation, mail about one subject
is one topic, appointments in mail land in a calendar by themselves, and the greeting and closing
("Lieber Max," ... "VG Paul") are put around what you wrote at the very end, from templates.

It is a third app of this project, built like the shopping assistant ([SHOP.md](SHOP.md)): its own crates,
mounted at `/v1/mail` inside the finance server behind the same token, and a module of screens
(`packages/mail`) that the finance app opens from **Settings > Groceries > Mail**.

> **What was and was not tested.** The Rust side (grouping, quote stripping, templates, invitations and
> text appointments, the sync, the HTTP API, the SMTP delivery) is tested with hand-written German and
> English mails, a fake IMAP server and a scripted SMTP server. The screens were driven in a real
> browser against the real server holding a demo mailbox (light and dark, phone and wide). **No real
> mailbox and no real outgoing mail server was ever contacted**, the screens were **never run on a
> phone**, and the screens were built from `@financer/ui` and the design language in [UI.md](UI.md),
> not checked against a Stitch design for mail (there is none in the Stitch project).

## Setup

The server reads and sends the mail, so the mailbox is set up on the server, in the environment. Build the
server with the `mail` feature (`cargo run -p financer-server --features mail`, `make dev` does not
include it; the release bundle and the bundle image do).

```sh
export FINANCER_MAIL_IMAP_HOST=imap.example.org
export FINANCER_MAIL_USERNAME=you@example.org
export FINANCER_MAIL_PASSWORD='an app password'      # Gmail, iCloud and Outlook need one
export FINANCER_MAIL_NAME='Paul Meier'               # shown to the people you write to
```

| Variable | Meaning |
|---|---|
| `FINANCER_MAIL_IMAP_HOST`, `_IMAP_PORT` | the incoming server; implicit TLS only (993) |
| `FINANCER_MAIL_SMTP_HOST`, `_SMTP_PORT`, `_SMTP_SECURITY` | the outgoing server. Default: `imap.` becomes `smtp.`, port 465 with TLS; port 587 uses STARTTLS. Plain connections are refused |
| `FINANCER_MAIL_USERNAME`, `FINANCER_MAIL_PASSWORD` | the login. The password is read from the environment only, never stored, never logged |
| `FINANCER_MAIL_ADDRESS`, `_NAME`, `_ALIASES` | who you are (address defaults to the username), and further addresses that are also you |
| `FINANCER_MAIL_INBOX`, `_SENT` | folder names, `INBOX` and `Sent` (`Gesendet`, `INBOX.Sent`, ...) |
| `FINANCER_MAIL_POLL_MINUTES`, `_MAX_AGE_DAYS` | the server checks every 5 minutes (0: only when asked); the first check reads 90 days |
| `FINANCER_MAIL_TIMEZONE` | the calendar's zone, `Europe/Berlin` by default; European zones and UTC are known |
| `FINANCER_MAIL_DATABASE_URL` | where mail is kept; by default a SQLite file `...-mail.db` beside the finance one (or the same PostgreSQL database) |
| `FINANCER_MAIL_ENABLED` | `false` switches the client off |

Without `FINANCER_MAIL_IMAP_HOST` the templates and the calendar still work; reading and sending do not.
Mail is **not** part of the finance export or backup: it is bulky and private, and lives in its own database.

## Where it lives, and how it looks

Mail is a tab of the app (Spending, Mail, Calendar, Groceries): the app's tab bar is around it, so the module has none of its own (`MailHost.embedded`; on its own it still has a bar, a rail or a sidebar). The chat list is laid out like Gmail: a search pill ("Search in mail") with the sync and menu buttons, the tabs People, Topics and Updates with a "3 new" under the ones that have something (`TabStrip`), an "Unread" chip, chats under Today, Yesterday, This week and Earlier, and an extended **Compose** button. Calendar (the events found in mail), Templates and Mailbox are in the menu (the three dots) and have a back button to the chats.

## What it does

**Chats.** Mail is grouped by person: everything exchanged with Max, in both directions and across subjects,
is one chat of bubbles, yours on the right. A mail to several people is a chat of its own. The bubble
shows what was said: the quoted reply chain (English, German, Outlook), the signature and the greeting and
closing are left out (tap a bubble marked "quoted text hidden" to read the original). When the subject
changes inside a chat, a topic marker shows it. The list of chats is grouped under Today, Yesterday, This
week and Earlier (the rule is `mail_format.list_group` in `crates/logic`). An "Unread only" chip under the tabs
shows just the chats with something new. A card at the top says how many chats need your attention, and each
day's heading says how many of its chats are unread.

**Topics.** The same mail grouped by subject instead: one thread per subject, whoever takes part. Threads
follow `In-Reply-To` and `References`; when a client dropped them, the same subject with a person in
common within two months joins them. A reply that arrives before its original still joins. Grouping is
computed when you look, never stored, so it cannot get stuck in a wrong state.

**Updates.** Newsletters, shops and notifications (`List-Unsubscribe`, `Precedence: bulk`, `no-reply@`,
...) are kept in their own list so they do not bury the people.

**Calendar.** Appointments are added by themselves:

- an invitation (`text/calendar` or an `.ics` attachment) is read exactly: time, place, update and
  cancellation (`SEQUENCE`, `METHOD:CANCEL`). Times in European zones are converted to your zone, other
  zones keep their wall time with a note. A repeating event lists its first date only.
- an appointment in a sentence ("Freitag um 19 Uhr", "12.11. um 14:30", "next Monday at 3pm",
  "5. November, 10-12 Uhr", "morgen um 9") is added too, marked **Check** because it is a guess. Dates
  without a time are not appointments unless a word like Termin or Einladung is there; deadlines
  ("bis zum", "fällig", "Rechnung") never are. A reply repeating the same appointment does not add it twice.
- You can remove any event (it stays removed when the mail is read again) or add one by hand. There is no
  calendar library: the agenda is a list by day, and days and times are typed.

**Greeting and closing.** Templates are set under **Templates**: a greeting ("Lieber {first_name},") and a
closing ("VG\n{my_first_name}"), with `{first_name}`, `{last_name}`, `{name}`, `{me}` and `{my_first_name}`.
A template can be for certain people (`max@example.com`, or a whole domain `@firma.de`); an address beats a
domain beats the default. When the recipient's name is not known the template's fallback ("Hallo,") is used,
or the greeting is left out and you are told. While you write, two chips above the box show what will be
put around the text; tap one to choose another template or none and to see the whole message as it will be
sent. What you typed stays as typed until you send. A greeting or closing you wrote yourself is kept and not
doubled.

**Sending.** Through your own SMTP server. Replies keep their thread (`In-Reply-To`, `References`, "Re:").
Bcc goes to the server only. The sent message is stored at once, so it is in the chat before the next check.

## Limits

- The mail is **read only**: folders are opened with `EXAMINE`, nothing is marked as read, moved or deleted
  on the server, and the sent mail is not appended to the Sent folder (most providers keep their own copy;
  it is recognised by its Message-ID and not stored twice). "Unread" is kept by this client. What was in the
  mailbox when you connected starts as read.
- Plain text only: HTML mail is shown as text, there are no attachments (invitations excepted), no drafts,
  no folders other than inbox and sent, no search inside the text of old messages beyond the last 5000.
- It needs the server; the on-phone backend ([EMBEDDED.md](EMBEDDED.md)) does not carry it.
- Text appointments are guesses in German and English only. Always look at ones marked **Check**.

## Development

```sh
cargo test -p financer-mail-core -p financer-mail-store -p financer-mail-api
cargo test -p financer-server --features mail
(cd packages/mail && npm ci && npm test)        # logic tests
(cd apps/catalog && npm ci && npm run typecheck) # the screens are type checked here
```

To look at the screens without a mail account, fill a demo database through the real sync and start the
server on it:

```sh
cargo run -p financer-mail-api --example seed_demo -- 'sqlite:///tmp/mail-demo.db?mode=rwc'
FINANCER_MAIL_DATABASE_URL='sqlite:///tmp/mail-demo.db?mode=rwc' FINANCER_MAIL_IMAP_HOST=imap.example.invalid \
  FINANCER_MAIL_USERNAME=you@example.org FINANCER_MAIL_PASSWORD=x FINANCER_MAIL_POLL_MINUTES=0 \
  cargo run -p financer-server --features mail
```

Layout: `crates/mail-core` (pure logic), `crates/mail-store` (tables, own migrations), `crates/mail-api`
(sync, SMTP, routes), `packages/mail` (client, logic, screens), new elements in `packages/ui` (`Avatar`,
`ChatBubble`, `DateBadge`, `DividerLabel`), shown in the catalog under **Mail**.
