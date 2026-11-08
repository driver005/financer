import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgendaList, Box, Button, Card, FloatingButton, Icon, IconButton, MiniMonth, MonthGrid, OptionList, Row, Scroll, Section, Sheet, Snackbar, Stack, Text, TextField, TimeGrid, Touchable, useLayout } from "@financer/ui";

import type { Calendar, CalendarEvent } from "@/api/client";
import { useApi } from "@/api/config";
import { getSecret, setSecret } from "@/api/storage";
import { WEEKDAY_SHORT, addDays, expand, longDay, parseQuickAdd, timeOf, weekOf, type Occurrence } from "@/calendar";
import { FEEDS, loadFeeds } from "@/calendarFeeds";
import { draftFromRule, newDraft, problem, ruleFromDto, toInput, type Draft } from "@/calendarForm";
import { toTone } from "@/calendarTones";
import { SCHEDULE_DAYS, VIEWS, agendaDays, dayColumns, miniCells, monthCells, nowMinutes, rangeFor, step, titleFor, type CalendarView } from "@/calendarView";
import { CalendarsSheet } from "@/components/calendar/CalendarsSheet";
import { EventDetail } from "@/components/calendar/EventDetail";
import { EventEditor } from "@/components/calendar/EventEditor";
import { Page } from "@/components/Page";
import { Loading, NeedsSetup } from "@/components/Status";
import { localIsoDate } from "@/period";

const VIEW_KEY = "calendar.view";
const HIDDEN_KEY = "calendar.hiddenFeeds";
const message = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");

export default function CalendarScreen() {
  const { api, loaded } = useApi();
  const router = useRouter();
  const { layout } = useLayout();
  const wide = layout !== "compact";
  const today = localIsoDate();

  const [view, setView] = useState<CalendarView>("month");
  const { date: jumpTo } = useLocalSearchParams<{ date?: string }>();
  const [anchor, setAnchor] = useState(today);
  // the search of the app leads to the day of an event
  useEffect(() => {
    if (typeof jumpTo === "string" && /^\d{4}-\d{2}-\d{2}$/.test(jumpTo)) setAnchor(jumpTo);
  }, [jumpTo]);
  const [scheduleDays, setScheduleDays] = useState(SCHEDULE_DAYS);
  const [calendars, setCalendars] = useState<Calendar[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [feedItems, setFeedItems] = useState<Occurrence[]>([]);
  const [hidden, setHidden] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [first, setFirst] = useState(true);
  const [detail, setDetail] = useState<Occurrence | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [calendarsOpen, setCalendarsOpen] = useState(false);
  const [viewsOpen, setViewsOpen] = useState(false);
  const [jumpOpen, setJumpOpen] = useState(false);
  const [quick, setQuick] = useState("");
  const [quickOpen, setQuickOpen] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  const latest = useRef(0);

  // what the person chose last time
  useEffect(() => {
    void (async () => {
      const saved = await getSecret(VIEW_KEY);
      if (saved && VIEWS.some((v) => v.value === saved)) setView(saved as CalendarView);
      try {
        const h = JSON.parse((await getSecret(HIDDEN_KEY)) ?? "[]");
        if (Array.isArray(h)) setHidden(h.filter((x): x is string => typeof x === "string"));
      } catch {
        // an unreadable list shows every feed
      }
      setReady(true);
    })();
  }, []);

  // the line for now moves every minute
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  const range = useMemo(() => rangeFor(view, anchor, scheduleDays), [view, anchor, scheduleDays]);

  const load = useCallback(async () => {
    if (!api || !ready) return;
    const id = ++latest.current;
    try {
      const [cals, evs, feeds] = await Promise.all([api.calendars(), api.calendarEvents(range.from, range.to), loadFeeds(api, range.from, range.to, new Set(hidden))]);
      if (id !== latest.current) return;
      setCalendars(cals);
      setEvents(evs);
      setFeedItems(feeds);
      setError(null);
    } catch (e) {
      if (id === latest.current) setError(message(e));
    } finally {
      if (id === latest.current) setFirst(false);
    }
  }, [api, ready, range.from, range.to, hidden]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const occurrences = useMemo(() => {
    const own = events.flatMap((e) => {
      const cal = calendars.find((c) => c.id === e.calendar_id);
      return cal?.visible ? expand(ruleFromDto(e), range.from, range.to, toTone(cal.tone)) : [];
    });
    return [...own, ...feedItems];
  }, [events, calendars, feedItems, range.from, range.to]);

  const open = useCallback((o: Occurrence) => setDetail(o), []);

  const go = (date: string) => {
    setAnchor(date);
  };
  const pickView = (v: CalendarView) => {
    setView(v);
    setScheduleDays(SCHEDULE_DAYS);
    void setSecret(VIEW_KEY, v);
  };
  // a day in the month view is selected; a phone lists its events under the grid
  const selectDay = (date: string) => setAnchor(date);

  const firstCalendar = calendars.find((c) => c.visible) ?? calendars[0];
  const startNew = (date: string, time?: string | null) => {
    setSaveError(null);
    setDraft(newDraft(date, firstCalendar?.id ?? null, time));
  };

  const reportFailure = (e: unknown) => setNote(message(e));

  const save = async () => {
    if (!api || !draft || problem(draft)) return;
    setSaving(true);
    setSaveError(null);
    try {
      if (draft.id === null) await api.createEvent(toInput(draft));
      else await api.updateEvent(draft.id, toInput(draft));
      setDraft(null);
      setNote(draft.id === null ? "Event added" : "Event saved");
      await load();
    } catch (e) {
      setSaveError(message(e));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (o: Occurrence, scope: "this" | "all") => {
    if (!api) return;
    try {
      if (scope === "this") await api.skipOccurrence(Number(o.eventId), o.startDate);
      else await api.deleteEvent(Number(o.eventId));
      setNote("Event deleted");
      await load();
    } catch (e) {
      reportFailure(e);
    }
  };

  const edit = (o: Occurrence) => {
    const e = events.find((x) => x.id === Number(o.eventId));
    if (!e) return;
    setSaveError(null);
    setDraft(draftFromRule(ruleFromDto(e)));
  };

  const quickAdd = async () => {
    if (!api || !firstCalendar) return;
    const parsed = parseQuickAdd(quick, today, anchor);
    if (!parsed) return;
    const d = { ...newDraft(parsed.date, firstCalendar.id, parsed.startTime), title: parsed.title, allDay: parsed.allDay, endTime: parsed.endTime ?? "10:00" };
    try {
      await api.createEvent(toInput(d));
      setQuick("");
      setQuickOpen(false);
      setNote(`Added “${parsed.title}”`);
      setAnchor(parsed.date);
      await load();
    } catch (e) {
      reportFailure(e);
    }
  };

  const saveCalendar = async (id: number | null, value: { name: string; tone: string; visible: boolean }) => {
    if (!api) return;
    try {
      if (id === null) await api.createCalendar(value);
      else await api.updateCalendar(id, value);
      await load();
    } catch (e) {
      reportFailure(e);
    }
  };

  const toggleFeed = (key: string) => {
    const next = hidden.includes(key) ? hidden.filter((k) => k !== key) : [...hidden, key];
    setHidden(next);
    void setSecret(HIDDEN_KEY, JSON.stringify(next));
  };

  const calendarName = (o: Occurrence) => (o.readOnly ? (FEEDS.find((f) => f.key === o.calendarId)?.name ?? "Feed") : (calendars.find((c) => c.id === Number(o.calendarId))?.name ?? "Calendar"));
  const detailEvent = detail && !detail.readOnly ? events.find((e) => e.id === Number(detail.eventId)) : undefined;

  if (loaded && !api) {
    return (
      <Page title="Calendar">
        <NeedsSetup />
      </Page>
    );
  }

  // one letter on a phone, as Google draws it
  const weekdayNames = WEEKDAY_SHORT.map((w) => (wide ? w : w.slice(0, 1)));

  const columns =
    view === "week"
      ? weekOf(anchor)
      : view === "3day"
        ? [anchor, addDays(anchor, 1), addDays(anchor, 2)]
        : [anchor];

  const todayButton = <IconButton icon="calendar-today" label="Today" onPress={() => go(today)} />;
  const viewButton = <IconButton icon="eye-outline" label={`View: ${VIEWS.find((v) => v.value === view)?.label ?? ""}`} onPress={() => setViewsOpen(true)} />;

  // Google's top bar: the month with an arrow that drops the small month down, then Today and the view menu
  const nav = (
    <Row gap="xs" align="center">
      <Touchable onPress={() => setJumpOpen(!jumpOpen)} label={`${titleFor(view, anchor)}, jump to a date`} selected={jumpOpen} hit={false} direction="row" align="center" gap="xs" grow>
        <Text variant="heading" numberOfLines={1}>{titleFor(view, anchor)}</Text>
        <Icon name={jumpOpen ? "menu-up" : "menu-down"} size="md" tone="muted" />
      </Touchable>
      {wide ? todayButton : null}
      <IconButton icon="chevron-left" label="Previous" onPress={() => go(step(view, anchor, -1))} />
      <IconButton icon="chevron-right" label="Next" onPress={() => go(step(view, anchor, 1))} />
      {wide ? viewButton : null}
    </Row>
  );

  const jump = jumpOpen && !wide ? (
    <Card>
      <MiniMonth
        title={titleFor("month", anchor)}
        weekdays={WEEKDAY_SHORT.map((w) => w.slice(0, 1))}
        weeks={miniCells(anchor, today, anchor, occurrences)}
        onSelect={(d) => {
          go(d);
          setJumpOpen(false);
        }}
        onPrev={() => go(step("month", anchor, -1))}
        onNext={() => go(step("month", anchor, 1))}
      />
    </Card>
  ) : null;

  const main = (
    <Stack gap="md" grow>
      {nav}
      {jump}
      {error ? <Text tone="danger">{error}</Text> : null}
      {view === "month" ? (
        <Scroll>
          {wide ? (
            <MonthGrid weekdays={weekdayNames} weeks={monthCells(anchor, today, anchor, occurrences, open)} onSelectDay={selectDay} />
          ) : (
            <>
              <Card>
                <MonthGrid weekdays={weekdayNames} weeks={monthCells(anchor, today, anchor, occurrences, open)} onSelectDay={selectDay} />
              </Card>
              <Text variant="subheading">{anchor === today ? `Today, ${longDay(anchor)}` : longDay(anchor, today)}</Text>
              <AgendaList days={agendaDays(anchor, anchor, today, occurrences, open).map((d) => ({ ...d, heading: "" }))} empty="Nothing planned this day." />
            </>
          )}
        </Scroll>
      ) : view === "schedule" ? (
        <Scroll>
          <AgendaList days={agendaDays(range.from, range.to, today, occurrences, open)} empty="Nothing planned for the next two months." />
          <Button label="Show more" variant="secondary" onPress={() => setScheduleDays(scheduleDays + SCHEDULE_DAYS)} />
        </Scroll>
      ) : (
        <TimeGrid days={dayColumns(columns, today, anchor, occurrences, open)} nowMinutes={columns.includes(today) ? nowMinutes(now) : undefined} onSlot={(date, minutes) => startNew(date, timeOf(minutes))} onSelectDay={view === "week" || view === "3day" ? (d) => { setAnchor(d); pickView("day"); } : undefined} />
      )}
    </Stack>
  );

  const side = (
    <Stack gap="lg">
      <MiniMonth
        title={titleFor("month", anchor)}
        weekdays={WEEKDAY_SHORT.map((w) => w.slice(0, 2))}
        weeks={miniCells(anchor, today, anchor, occurrences)}
        onSelect={go}
        onPrev={() => go(step("month", anchor, -1))}
        onNext={() => go(step("month", anchor, 1))}
      />
      <TextField label="Quick add" value={quick} onChangeText={setQuick} placeholder="Lunch with Anna tomorrow 12:30" onSubmit={() => void quickAdd()} returnKeyType="done" />
      <Section title="Calendars" quiet action={{ label: "Manage", onPress: () => setCalendarsOpen(true) }}>
        <Stack gap="xs">
          {calendars.map((c) => (
            <Text key={c.id} variant="label" tone={c.visible ? "default" : "subtle"}>{c.name}</Text>
          ))}
        </Stack>
      </Section>
    </Stack>
  );

  return (
    <Page
      title="Calendar"
      fixed
      actions={
        <>
          {wide ? null : (
            <>
              {todayButton}
              {viewButton}
              <IconButton icon="flash-outline" label="Quick add" onPress={() => setQuickOpen(!quickOpen)} selected={quickOpen} />
            </>
          )}
          <IconButton icon="calendar-multiple" label="Calendars" onPress={() => setCalendarsOpen(true)} />
        </>
      }
      footer={
        note ? (
          <Box px="lg" pb="md">
            <Snackbar visible onDismiss={() => setNote(null)}>{note}</Snackbar>
          </Box>
        ) : undefined
      }
    >
      {first && !error ? (
        <Loading rows={4} />
      ) : (
        <Box grow>
          {!wide && quickOpen ? (
            <Box pb="md">
              <TextField value={quick} onChangeText={setQuick} placeholder="Lunch with Anna tomorrow 12:30" onSubmit={() => void quickAdd()} returnKeyType="done" autoFocus clearable />
            </Box>
          ) : null}
          {wide ? (
            <Row gap="xl" align="stretch" grow>
              <Box basis="quarter">{side}</Box>
              <Box grow>{main}</Box>
            </Row>
          ) : (
            main
          )}
          <FloatingButton label="Create" onPress={() => startNew(anchor)} />
        </Box>
      )}
      <EventDetail
        occurrence={detail}
        calendar={detail ? calendarName(detail) : ""}
        repeat={detailEvent ? ruleFromDto(detailEvent).repeat : undefined}
        reminders={detailEvent?.reminders}
        onClose={() => setDetail(null)}
        onEdit={() => detail && edit(detail)}
        onDelete={(scope) => detail && void remove(detail, scope)}
        onOpenLink={(href) => router.push(href as never)}
      />
      <EventEditor draft={draft} calendars={calendars} saving={saving} error={saveError} onChange={setDraft} onSave={() => void save()} onClose={() => setDraft(null)} />
      <Sheet visible={viewsOpen} onClose={() => setViewsOpen(false)} title="View">
        <OptionList
          options={VIEWS}
          value={view}
          onChange={(v) => {
            pickView(v);
            setViewsOpen(false);
          }}
        />
      </Sheet>
      <CalendarsSheet
        visible={calendarsOpen}
        calendars={calendars}
        feeds={FEEDS.map((f) => ({ key: f.key, name: f.name, description: f.description, tone: f.tone, visible: !hidden.includes(f.key) }))}
        error={null}
        onClose={() => setCalendarsOpen(false)}
        onToggle={(c) => void saveCalendar(c.id, { name: c.name, tone: c.tone, visible: !c.visible })}
        onToggleFeed={toggleFeed}
        onSave={(id, v) => void saveCalendar(id, v)}
        onDelete={(c) => {
          if (!api) return;
          void api.deleteCalendar(c.id).then(load, reportFailure);
        }}
      />
    </Page>
  );
}
