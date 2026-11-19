# Pantry — Playful Finance Design System (Duolingo-inspired)

A clean, friendly, game-like finance UI. Bright, optimistic, high contrast,
chunky and calm — never corporate, never dense.

## Colour tokens

| Token | Hex | Use |
| --- | --- | --- |
| primary | `#58CC02` | main buttons, active tab, progress |
| primary-dark | `#46A302` | button bottom edge / 3D shadow |
| mint | `#D7FFB8` | success pills, completed states |
| ink | `#3C3C3C` | primary text |
| muted | `#777777` | secondary text |
| canvas | `#F7F7F7` | screen background |
| surface | `#FFFFFF` | cards, inputs, nav |
| border | `#E5E5E5` | card outlines |
| yellow | `#FFC800` | streaks, XP, highlights |
| red | `#FF4B4B` | errors, overspend |
| blue | `#1CB0F6` | links, info |
| purple | `#CE82FF` | premium / Plus |
| orange | `#FF9600` | warnings |

## Shape & depth

- Cards: white, 24px radius, 2px `#E5E5E5` border, 16–20px padding
- Buttons: 16px radius, 2px darker bottom edge, uppercase bold label, min 52px tall
- Inputs: white, 2px border, 16px radius, 56px tall, large text
- Progress: thick 16px rounded track, green fill, small emoji marker
- Tabs: white bar with 5 evenly spaced items, active item green

## Typography

- Headlines: Nunito Sans, ExtraBold, 28–34px, tight leading
- Body: Nunito Sans, SemiBold, 16px
- Captions: Nunito Sans, Bold, 13px uppercase for labels
- Numbers: Nunito Sans, ExtraBold, 32px for balances

## Voice & content

Short, upbeat, second person. Celebrate progress ("Nice! You saved 12 €"),
never shame. Every screen has one clear next action.

## Components

- `HeroCard`: green gradient card with big number and one CTA
- `StatCard`: icon + label + big value + progress
- `RowCard`: emoji icon, title, subtitle, value/chevron
- `CategoryChip`: emoji + bold label, pressable
- `Badge`: mint/yellow/purple pill
- `LessonCard`: numbered, game-like task card
- `BottomNav`: 5 tabs with emoji icons

## Flow rule

Every screen: header greeting/title → one hero card → 2–4 compact cards →
one primary CTA → bottom nav. Search, filters and editing live in sheets,
not inline. Empty states include a friendly mascot emoji and a CTA.
