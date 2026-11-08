# Calendar

A calendar in the finance app (its own tab), modelled on Google Calendar, that also shows what happens in the
rest of the app: payday, subscription charges, planned meals and, with the shopping assistant, the end of a
phone or internet contract.

## What you can do

- **Views**: month, week, 3 days, day and schedule (a list of what is coming), chosen from the eye button at the
  top. The last view is remembered. It is laid out like Google Calendar: the month with an arrow (it drops a
  small month to jump to a date), a Today button, a coloured bar with the title for each event in the month
  (also on a phone), solid coloured tiles in the day and week, a line with a dot for now, and in the schedule a
  column with the weekday and day number (today in a circle) beside the events.
  On a tablet or laptop a side panel shows a small month, quick add and the calendars.
- **Add**: the rounded-square button, a tap on an empty place of the week, 3-day or day view (the event starts there), or
  the quick-add line: `Lunch with Anna tomorrow 12:30-13:30`, `Dentist friday 3pm`, `Rent 1/12 all day`.
- **Change and delete**: tap an event for its details, then Edit or Delete. For a repeating event, Delete asks
  "this event" (only that day is skipped) or "all events".
- **Events**: title, all day or from/to (date and time), repeat, calendar, reminders, location, notes.
- **Overlaps**: events at the same time lie on top of each other, each a little further right so every title
  stays readable; events that start together (within half an hour, where the titles would hide
  each other) sit side by side instead.
- **Repeats**: every n days, weeks (on chosen weekdays), months or years, ending never, on a date or after n
  times. A monthly event on the 31st happens on the last day of shorter months.
- **Calendars**: several, each with a colour that can be shown or hidden. There is always at least one.
- **Reminders**: a local notification before the start (at the start, 10 minutes, 30 minutes, 1 hour, 1 day,
  1 week). Switch on "Event reminders" in Settings, Privacy and security. The next two weeks are scheduled each
  time the app opens or comes back to the foreground.
- **Today** shows "Coming up" with the next events of the next two days.

## Connected to the rest of the app

Feed calendars fill themselves, are read-only and can be hidden in the calendars list ("From the rest of the
app"). Tapping one of their events opens the screen it comes from.

| Feed | Comes from | Opens |
| --- | --- | --- |
| Payday | the payday day in Settings | Budget |
| Subscription charges | expected charges of the subscription watchdog | Subscriptions |
| Meal plan | the planned meals of each week | Meal plan |
| Shopping | the end date of a current plan (the shopping assistant's "my plan"), and a reminder two months before to look for a new one | Shopping assistant |

The shopping feed needs the assistant on the same server (`/v1/shop`); without it the feed is simply empty.

## How it works

- **Server** (`crates/store/src/calendar.rs`, `crates/api/src/calendar.rs`): tables `calendars` and
  `calendar_events`, endpoints under `/v1/calendar` (`calendars`, `events`, `events/{id}/exceptions`), included in
  the OpenAPI document, the JSON export and import, and served by the backend inside the phone as well.
- **Dates are wall-clock**: `YYYY-MM-DD` and `HH:MM` with no time zone, so an event at 09:00 is at 09:00 wherever
  the phone is. Weeks start on Monday. An all-day event has no times and its end date is included.
- **A repeating event is stored once** with its rule. The server returns the events that can show in the asked
  range; the app expands the repeats (`src/calendar.ts`) and lays out overlapping events side by side. A count
  includes deleted occurrences (as in other calendars).
- **App logic** is plain TypeScript with unit tests: `calendar.ts` (dates, repeats, layout, quick add),
  `calendarView.ts` (what each view draws), `calendarForm.ts` (the editor's draft), `calendarFeeds.ts` (the feed
  calendars), and the reminder plan in `notifyPlan.ts`.

## Not covered

- Changing a single occurrence of a series (only "this event" can be deleted; an edit changes the whole series).
- Time zones, invitations, attachments, drag and drop, other people's calendars, importing or exporting `.ics`.
- Local reminders and the screens were not run on a phone; the screens were driven in a desktop browser at phone
  and laptop sizes.

## Design

The calendar screens were drawn in Stitch (HeroUI design system, project "Shopping Assistant") before the
layout was changed: the phone month view, the 3-day view and the new-event sheet. What was taken over: the title
on the left with the Today pill and the chevrons on the right, the month grid in a white card with the selected
day's events as cards (a colour bar on the left, the time on the right) under it, and in the editor icons on the
date and time rows, the times as soft blue pills and the location and notes together in one card. Stitch's 3-day
grid placed overlapping events badly, so the grid keeps its own layout. The laptop week screen did not come back
from Stitch (the service timed out), so that layout follows the other two.
