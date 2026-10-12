# UI pass: Settings, onboarding and the small list screens

A visual and structural pass over **Settings**, the **first-run setup**, **Rules**, **Alerts**,
**Subscriptions** and the **bank sync** screen. Behaviour, data flow, API calls and routes are
unchanged. Screenshots (390 x 844, light and dark, from a static web build against a mocked
backend) are in `docs/ui/settings/`.

Before and after: `settings-before-light.png` / `settings-after-light.png` / `settings-after-dark.png`
(every panel open: `settings-panels-open-dark.png`, validation and the confirm:
`settings-validation-confirm-light.png`), `onboarding-household-before-light.png` /
`onboarding-household-after-dark.png`, `onboarding-rhythm-after-light.png`,
`rules-before-light.png` / `rules-form-after-light.png`, `alerts-after-dark.png`,
`alerts-empty-after-light.png`. The images are scaled to 300 px wide.

## References

**The Mobbin library could not be used** (it needs a paid plan), so nothing here was checked
against Mobbin screens. The patterns come from established conventions instead:

* iOS Settings and Android settings: a grouped list, one row per setting (icon, title, current
  value, chevron), section headers, and a short footnote under a group instead of a box of text.
* Fintech onboarding (Monzo, Revolut): plain-language "why we ask", one question per screen,
  a thin progress bar, security wording next to anything sensitive.
* Duolingo: the mascot reacts to answers, chunky 3D buttons, one clear primary action.

## Settings

Five sections, with a row of jump chips at the top (a table of contents; it scrolls to the section
and does not animate when the system asks for reduced motion):

| Section | Rows |
|---------|------|
| Account & data | **Backend** (panel: server or this phone, address and token with inline checks, connection status, a *Danger zone* with a confirmed "Forget this server"), on-phone keys (only in phone mode), **Export and import**, **Encrypted backup** |
| Money | **Budget period** (payday), Categorization rules, Subscriptions, Alerts, Bank sync. A comment in `settings.tsx` marks where more money cards go |
| Groceries | **How I learn what you buy**, Usual items, Receipts, Meal plan, **Recipe ideas by AI**, Price sources (read-only) |
| Privacy & security | Lock the app (phone only), the three notification switches, a "What to expect" panel |
| About | App version (read-only), Replay setup |

Three kinds of row, all in `src/components/settings/SettingsKit.tsx`:

* **Link row**: icon, title, subtitle, chevron. Goes to an existing route.
* **Panel row**: the same header with a chevron that opens the form in place. Nothing animates.
  The Backend panel opens by itself only when no server is saved.
* **Read-only row**: no chevron. Used for the connection status, the price-source count and the
  version. These are the values that are meant to come from the server's configuration
  (`financer.toml`), so the app shows them and says where they are set instead of offering a field.
  Manual fields (address, token, on-phone keys, model name) still work.

### Adding a card

Each card is its own component. A new one (the bank connections card, say) is one line inside the
`SettingsGroup` of its section in `src/app/settings.tsx`; a panel is
`<SettingsPanel icon title summary>...</SettingsPanel>`, a link is `<SettingsRow onPress>`.

### Behaviour that was added on purpose

* Status messages sit inside the panel they belong to, not at the bottom of the page.
* Confirm first: forgetting the server, forgetting the saved backup passphrase (it switches
  automatic backups off) and deleting a rule. The button turns into a question that says what
  happens, a solid red confirm button and Cancel.
* Inline validation: the server address while typing (`validateServer`), the token once the field
  was left, the backup passphrase pair, the bank code (8 digits) and the IBAN check digits on the
  sync screen. The bank hints never block the button; the server has the last word.
* The scroll view sits in a `KeyboardAvoidingView` (iOS) and adjusts its insets, so fields are not
  hidden by the keyboard.

## Onboarding

The steps, their order and what they write are unchanged (see `ONBOARDING.md`). What changed:

* A smaller mascot above the scrolling answers on tall screens (more room for the question). It
  does not bob when the system asks for reduced motion. On short screens the shared `Mascot` still
  scrolls with the page.
* Stores are 44 pt pills with a check mark; payday tiles are 44 pt (they were 40).
* Server address and token get inline messages as soon as something is typed or the field is left.
* "3/8" is read as "Step 3 of 8"; field labels are headings for screen readers.

## Rules, Alerts, Subscriptions, Sync

* **Rules**: a numbered list of rules (the number is the priority), 44 pt move/edit/delete buttons
  (move up is disabled on the first rule, down on the last), delete asks first, the category is a
  set of 44 pt pills, an empty state with the mascot.
* **Alerts**: "Show dismissed" is a toggle row, dismiss is 44 pt, empty states ("All quiet").
* **Subscriptions**: 48 pt range buttons, an empty state, the error as an inline message.
* **Sync**: grouped form, hints for bank code and IBAN, "Remember the PIN" as a toggle row.

## Accessibility

* **Contrast.** The theme's `bad` (#ea2b2b) is 4.30:1 on white and `good` (#16a34a) 3.30:1, fine
  for fills but under 4.5:1 as small text. `useInk()` in `SettingsKit.tsx` gives text colours that
  pass in both themes: danger #c81e1e on white 5.74:1 (dark: the theme's #ff6b6b, 6.50:1), success
  #15803d 5.02:1 (dark #4ade80, 10.35:1). Muted text is 5.5:1 or better on every surface in both
  themes; the accent is 5.3:1 or better; button text on the accent, 5.7:1 / 6.7:1. Computed from
  the hex values, not measured on a device.
* **Touch targets.** Every row is at least 56 high, every button, pill, tile and icon button at
  least 44. A scan of the rendered web pages found nothing under 44 except the decorative switch
  picture inside a toggle row (the row itself is the target).
* **Roles and labels.** Rows are buttons (panels report `expanded`), switch rows are
  `switch` with `checked`, option groups are `radiogroup`/`radio`, errors are `alert`s in a live
  region, section titles are headings.
* **Dynamic type.** Text uses the platform's font scaling; heights are minimums, never fixed, so
  larger text pushes rows down. Not tested with a large system font size.
* **Reduced motion.** The jump chips scroll without animation, panels do not animate, the
  onboarding mascot stands still.

## Found, not changed (shared files)

* `Mascot.tsx` and `Bar` (progress bar) in `ui.tsx` animate without checking the reduced-motion
  setting.
* `ChunkyButton`'s red tone (white on #ea2b2b, 4.30:1; in dark white on #ff6b6b, 2.6:1) and
  `HelperText` errors (`text-danger`, 4.30:1 in light) are below 4.5:1. Screens in this pass use
  `DangerButton` and `FieldMessage` instead.
* `SegmentedButtons` and the compact `ChunkyButton` are about 36 high; this pass uses `Segmented`
  (48) in its own screens. `CategoryPicker` (used by the recategorize sheet) has 28 pt chips.

## Tests and what was not tested

* `apps/mobile/tests/settingsPlan.test.ts` covers the section list, the connection state, the
  summaries, and the bank code and IBAN checks (`npm test`).
* The web build was walked through in headless Chromium at 390 x 844, light and dark, against a
  small mock of the `/v1` endpoints: every onboarding step, Settings (collapsed, every panel open,
  validation and the confirm), Rules (list, form, confirm, empty), Alerts, Subscriptions (full and
  empty), Sync.
* **Nothing ran on a phone or an emulator.** Not exercised: the app lock and notification rows
  (they do not exist on the web, so those two cards were only type-checked), the keyboard behaviour
  on iOS and Android, haptics, the on-phone backend panel, real screen readers, large system fonts.
