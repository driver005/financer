# Medusa UI on Expo

The Medusa design system (`@medusajs/ui`, `@medusajs/icons`, MIT) lives in `docs/medusa` (a shallow
clone; it is not part of the build). Its components are React for the DOM: Tailwind classes, Radix and
`react-aria`. They cannot run on Expo, so they are ported to `packages/ui` on tokens only.

## What is automatic, what is by hand

| Part | How |
| --- | --- |
| Icons (465) | `make ui-icons` runs `crates/uiconv`, which parses the TSX with `oxc` and writes `packages/ui/src/constants/medusaIcons.ts`. `MedusaIcon` draws them with `react-native-svg` at a token size. |
| Tailwind classes | `crates/uiconv/src/tailwind.rs` maps a class to a token prop (`px-3` to `px="md"`). `uiconv classes` reports what has no token yet (about a quarter of all classes: fixed sizes, positions, single-side borders). |
| Components | Ported by hand in `packages/ui/src/medusa/`, with the class report as the guide. Radix and `react-aria` behaviour (focus traps, pop-over positioning, hover) is replaced by what a phone has: modals, sheets, long press. |

Run the class report from `crates/uiconv`:

```
cargo run --release -- classes ../../docs/medusa/packages/design-system/ui/src ../../packages/ui/src/constants
```

## The 46 Medusa components

Ported (`packages/ui/src/medusa/`): Alert, Code, Command, CommandBar, Container, CurrencyInput, Drawer,
DropdownMenu, FocusModal, Heading, IconBadge (as `MedusaIconBadge`), InlineTip, Kbd, Label, OTPInput,
Popover, ProgressAccordion, ProgressTabs, Prompt, RadioGroup, Select, StatusBadge, Table, Tabs,
Textarea, Toast, Toaster (`ToastProvider` and `useToast`), Tooltip.

Already in `packages/ui`: Avatar, Badge, Button, Checkbox, Divider, Hint, IconButton, Input (`TextField`),
Skeleton, Switch, Text.

Not ported:

- Calendar, DatePicker, DateSegment, TimeInput: `react-aria` date handling. `packages/ui/src/calendar` has a month grid and a `TimePicker`; a date field on top of them is a separate task.
- CodeBlock: needs a monospace font token and syntax colours.
- Copy: needs a clipboard package (`expo-clipboard`); adding a dependency needs a decision.
- I18nProvider: the DOM locale provider, nothing to do on a phone.

## Known differences

- Tooltip opens on long press; there is no hover on a phone.
- Popover, Tooltip, Prompt, DropdownMenu and Command share `Overlay` (a card over a scrim, centred or at the bottom); they do not anchor to their trigger.
- Dropped from icons: SVG filters and blend modes (22 decorative icons lose their glow).
- No monospace font: `Code` uses the body font.

The catalog shows all of it under "Medusa".
