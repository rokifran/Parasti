// Calendar page: day, month and year views backed by the /api/events CRUD.
// One fetch per visible year serves all three views. Dates are local
// wall-clock YYYY-MM-DD keys built from the Date parts (never toISOString,
// which would shift the day to UTC).

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { api } from '../api/client';
import { CalendarEvent, Label, Task } from '../types';
import { LABEL_COLORS } from '../../server/shared/labels';
import { useLanguage } from '../i18n/LanguageContext';
import { ConfirmDialog } from './ConfirmDialog';
import { LabelPickerModal } from './LabelPickerModal';
import { LabelChip } from './LabelChip';
import { TaskEditModal } from './TaskEditModal';
import { CalendarIcon, ChevronLeftIcon, ChevronRightSmallIcon, PlusIcon, XIcon } from './Icons';

type View = 'day' | 'month' | 'year';

const pad = (n: number) => String(n).padStart(2, '0');
const toKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
// Month/year stepping always lands on day 1 so the cursor stays a valid
// representative of the period (addMonths rolls over long months cleanly).
const addMonths = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth() + n, 1);
const todayKey = toKey(new Date());

// Monday-first 6-row (42-cell) grid for one month, used by both the big month
// view and the mini months in the year view.
function monthGrid(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  const start = new Date(year, month, 1 - (first.getDay() + 6) % 7);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

// Day view geometry: each hour is a fixed slice of an absolutely positioned
// 24h canvas; blocks are placed by minutes-since-midnight. GUTTER must match
// the CSS variable --calendar-gutter (time-label column width).
const HOUR_HEIGHT = 48;
const GUTTER = 64;

// "HH:MM" (input[type=time]) or "HH:MM:SS" (SQLite) -> minutes since midnight.
function parseHm(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(s.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}
const hm = (min: number) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;

// First valid label color as a CSS custom property value; undefined lets the
// stylesheet fall back to the theme accent.
function blockColor(labels: Label[] | undefined): string | undefined {
  const c = labels?.find(l => l.color)?.color;
  return c && (LABEL_COLORS as readonly string[]).includes(c) ? `var(--label-${c})` : undefined;
}

// Timed entries sorted by start, overlapping runs side by side in columns.
// Greedy: a cluster is a run of entries that all start before the cluster's
// latest end; inside a cluster each entry takes the first free column.
interface TimedEntry<T> { kind: 'event' | 'task'; item: T; start: number; end: number; col: number; cols: number; }
function layoutTimed<T>(raw: Array<{ kind: 'event' | 'task'; item: T; start: number; end: number }>): TimedEntry<T>[] {
  const sorted = [...raw].sort((a, b) => a.start - b.start || a.end - b.end);
  const out: TimedEntry<T>[] = [];
  let cluster: typeof raw = [];
  let clusterEnd = -1;
  const flush = () => {
    if (!cluster.length) return;
    const colEnds: number[] = [];
    const cols: number[] = [];
    for (const e of cluster) {
      let col = colEnds.findIndex(end => end <= e.start);
      if (col === -1) { col = colEnds.length; colEnds.push(e.end); }
      else colEnds[col] = e.end;
      cols.push(col);
    }
    cluster.forEach((e, i) => out.push({ ...e, col: cols[i], cols: colEnds.length }));
    cluster = [];
    clusterEnd = -1;
  };
  for (const e of sorted) {
    if (cluster.length && e.start >= clusterEnd) flush();
    cluster.push(e);
    clusterEnd = Math.max(clusterEnd, e.end);
  }
  flush();
  return out;
}

// View and cursor live in the URL (?view=day&date=YYYY-MM-DD) so the browser's
// back/forward buttons move between calendar states the same way they do
// between pages. Invalid or missing params fall back to month view / today.
const VIEWS: View[] = ['day', 'month', 'year'];
function parseView(v: string | null): View {
  return VIEWS.includes(v as View) ? (v as View) : 'month';
}
function parseDate(s: string | null): Date {
  if (s && /^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    if (!isNaN(dt.getTime()) && toKey(dt) === s) return dt;
  }
  return new Date();
}

export function CalendarPage() {
  const { t, language } = useLanguage();
  // URL is the source of truth for view + date, so back/forward work.
  const [params, setParams] = useSearchParams();
  const view = parseView(params.get('view'));
  const cursor = parseDate(params.get('date'));
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // null = closed; { event: null } = create on `date`, else edit that event.
  // `start` prefills the time field when creating from an empty grid slot.
  const [modal, setModal] = useState<{ date: string; start?: string; event: CalendarEvent | null } | null>(null);
  const [taskModal, setTaskModal] = useState<Task | null>(null);
  // `now` is state so the current-time line moves and the day view rolls over
  // at midnight without a manual refresh.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  // `replace` for in-place adjustments (prev/next/today), push for view
  // changes and date picks, so back undoes the "navigation" steps first.
  const setUrl = useCallback((nextView: View, nextDate: Date, replace = false) => {
    setParams({ view: nextView, date: toKey(nextDate) }, { replace });
  }, [setParams]);

  const year = cursor.getFullYear();
  const reload = useCallback(() => {
    let active = true;
    setLoading(true);
    setError(null);
    const from = `${year}-01-01`;
    const to = `${year}-12-31`;
    // Task failures must not blank the events the user is looking at.
    Promise.all([
      api.events.list(from, to),
      api.tasks.list({ from, to }).catch(err => {
        console.error('Failed to load tasks', err);
        return { tasks: [] as Task[] };
      }),
    ])
      .then(([evRes, taskRes]) => {
        if (!active) return;
        setEvents(evRes.events);
        setTasks(taskRes.tasks);
      })
      .catch(err => {
        console.error('Failed to load events', err);
        if (active) setError(t('calendar.loadError'));
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year]);

  useEffect(() => reload(), [reload]);

  // date -> events for that date (server already sorts within a date).
  const byDate = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const e of events) {
      const list = map.get(e.event_date);
      if (list) list.push(e); else map.set(e.event_date, [e]);
    }
    return map;
  }, [events]);

  const step = (dir: number) => {
    if (view === 'day') setUrl(view, addDays(cursor, dir), true);
    else if (view === 'month') setUrl(view, addMonths(cursor, dir), true);
    else setUrl(view, addMonths(cursor, dir * 12), true);
  };

  const openDay = (d: Date) => setUrl('day', d);
  const openMonth = (d: Date) => setUrl('month', new Date(d.getFullYear(), d.getMonth(), 1));

  const locale = language;
  const headerTitle = view === 'day'
    ? new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(cursor)
    : view === 'month'
      ? new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(cursor)
      : String(year);
  const dayLabel = (d: Date) => new Intl.DateTimeFormat(locale, { day: 'numeric' }).format(d);

  const dayEvents = byDate.get(toKey(cursor)) ?? [];
  const dayTasks = useMemo(() => tasks.filter(task => task.due_date === toKey(cursor)), [tasks, cursor]);

  const toggleTask = useCallback(async (task: Task) => {
    try {
      await api.tasks.update(task.id, { status: task.status === 'done' ? 'open' : 'done' });
      reload();
    } catch (err) {
      console.error('Failed to update task', err);
    }
  }, [reload]);
  const weekdayNames = useMemo(() => {
    // 2024-01-01 is a Monday, so +i walks Mon..Sun in order.
    const fmt = new Intl.DateTimeFormat(locale, { weekday: 'short' });
    return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(2024, 0, 1 + i)));
  }, [locale]);

  return (
    <div className="calendar-page">
      <header className="calendar-header">
        <h1 className="calendar-title"><CalendarIcon size={18} /> {t('calendar.title')}</h1>
        <div className="calendar-nav">
          <button type="button" className="calendar-nav-btn" onClick={() => step(-1)} aria-label="Previous">
            <ChevronLeftIcon size={16} />
          </button>
          <button type="button" className="calendar-nav-btn calendar-nav-btn--today" onClick={() => setUrl(view, new Date(), true)}>
            {t('calendar.today')}
          </button>
          <button type="button" className="calendar-nav-btn" onClick={() => step(1)} aria-label="Next">
            <ChevronRightSmallIcon size={16} />
          </button>
          <span className="calendar-header-title">{headerTitle}</span>
        </div>
        <div className="calendar-actions">
          <div className="calendar-view-switch" role="tablist">
            {(['day', 'month', 'year'] as View[]).map(v => (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={view === v}
                className={`calendar-view-btn ${view === v ? 'active' : ''}`}
                onClick={() => setUrl(v, cursor)}
              >
                {t(`calendar.view${v[0].toUpperCase()}${v.slice(1)}` as const)}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="calendar-add-btn"
            onClick={() => setModal({ date: toKey(cursor), event: null })}
          >
            <PlusIcon size={14} /> {t('calendar.newEvent')}
          </button>
        </div>
      </header>

      {error && <div className="calendar-error" role="alert">{error}</div>}

      {loading ? (
        <div className="calendar-empty">…</div>
      ) : view === 'day' ? (
        <DayView
          cursor={cursor}
          events={dayEvents}
          tasks={dayTasks}
          now={now}
          onOpenEvent={e => setModal({ date: e.event_date, event: e })}
          onOpenTask={setTaskModal}
          onToggleTask={toggleTask}
          onCreateAt={start => setModal({ date: toKey(cursor), start, event: null })}
        />
      ) : view === 'month' ? (
        <div className="calendar-month">
          <div className="calendar-weekdays">
            {weekdayNames.map(w => <span key={w} className="calendar-weekday">{w}</span>)}
          </div>
          <div className="calendar-grid">
            {monthGrid(year, cursor.getMonth()).map((d, i) => {
              const key = toKey(d);
              const outside = d.getMonth() !== cursor.getMonth();
              const hasEvents = (byDate.get(key)?.length ?? 0) > 0;
              return (
                <button
                  key={i}
                  type="button"
                  className={`calendar-cell ${outside ? 'calendar-cell--outside' : ''} ${key === todayKey ? 'calendar-cell--today' : ''}`}
                  onClick={() => openDay(d)}
                >
                  <span className="calendar-cell-day">{dayLabel(d)}</span>
                  {hasEvents && <span className="calendar-event-dot" />}
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="calendar-year-grid">
          {Array.from({ length: 12 }, (_, m) => (
            <div key={m} className="calendar-minimonth">
              <button type="button" className="calendar-minimonth-title" onClick={() => openMonth(new Date(year, m, 1))}>
                {new Intl.DateTimeFormat(locale, { month: 'long' }).format(new Date(year, m, 1))}
              </button>
              <div className="calendar-minimonth-weekdays">
                {weekdayNames.map(w => <span key={w}>{w[0]}</span>)}
              </div>
              <div className="calendar-minimonth-grid">
                {monthGrid(year, m).map((d, i) => {
                  const key = toKey(d);
                  const outside = d.getMonth() !== m;
                  const hasEvents = (byDate.get(key)?.length ?? 0) > 0;
                  return hasEvents && !outside ? (
                    <button key={i} type="button" className={`calendar-mini-cell calendar-mini-cell--event ${key === todayKey ? 'calendar-cell--today' : ''}`} onClick={() => openDay(d)}>
                      {dayLabel(d)}
                    </button>
                  ) : (
                    <span key={i} className={`calendar-mini-cell ${outside ? 'calendar-cell--outside' : ''} ${key === todayKey ? 'calendar-cell--today' : ''}`}>
                      {dayLabel(d)}
                    </span>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {modal && (
        <EventModal
          initialDate={modal.date}
          initialStart={modal.start}
          event={modal.event}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); reload(); }}
        />
      )}

      {taskModal && (
        <TaskEditModal
          task={taskModal}
          onClose={() => setTaskModal(null)}
          onSaved={() => { setTaskModal(null); reload(); }}
        />
      )}
    </div>
  );
}

// Day view: Google-Calendar-style single day. Head row (timezone gutter,
// weekday/date, all-day strip) stays put; the 24h grid below scrolls. Timed
// events and tasks are absolutely positioned blocks; empty-slot clicks create
// an event prefilled with date + rounded-down 30-min time.
function DayView({ cursor, events, tasks, now, onOpenEvent, onOpenTask, onToggleTask, onCreateAt }: {
  cursor: Date;
  events: CalendarEvent[];
  tasks: Task[];
  now: Date;
  onOpenEvent: (e: CalendarEvent) => void;
  onOpenTask: (task: Task) => void;
  onToggleTask: (task: Task) => void;
  onCreateAt: (start: string) => void;
}) {
  const { t, language } = useLanguage();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const hoursRef = useRef<HTMLDivElement | null>(null);

  const isToday = toKey(cursor) === toKey(now);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  // Jump the scroll position once per day switch: to "now" when viewing today,
  // otherwise to the morning. nowMinutes is intentionally not a dependency.
  const dayKey = toKey(cursor);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const target = isToday ? now.getHours() * HOUR_HEIGHT : 8 * HOUR_HEIGHT;
    el.scrollTop = Math.max(0, target - HOUR_HEIGHT);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayKey]);

  const allDayEvents = events.filter(e => !parseHm(e.start_time));
  const allDayTasks = tasks.filter(task => !parseHm(task.due_time));
  const timed = layoutTimed<CalendarEvent | Task>([
    ...events
      .map(e => ({ kind: 'event' as const, item: e, start: parseHm(e.start_time) }))
      .filter((e): e is typeof e & { start: number } => e.start !== null)
      .map(e => {
        const end = parseHm(e.item.end_time);
        // No end time (or an inverted range) reads as a one-hour event.
        return { ...e, end: end !== null && end > e.start ? end : e.start + 60 };
      }),
    ...tasks
      .map(task => ({ kind: 'task' as const, item: task, start: parseHm(task.due_time) }))
      .filter((task): task is typeof task & { start: number } => task.start !== null)
      .map(task => ({ ...task, end: task.start + 60 })),
  ]);

  const hourFmt = useMemo(() => new Intl.DateTimeFormat(language, { hour: 'numeric' }), [language]);
  const weekdayShort = useMemo(
    () => new Intl.DateTimeFormat(language, { weekday: 'short' }).format(cursor).toUpperCase(),
    [language, cursor]
  );
  const dayNumber = new Intl.DateTimeFormat(language, { day: 'numeric' }).format(cursor);
  const tzOffset = -cursor.getTimezoneOffset() / 60;
  const tzLabel = `${t('calendar.gmt')}${tzOffset >= 0 ? '+' : '−'}${Math.abs(tzOffset % 1) === 0 ? Math.abs(tzOffset) : Math.abs(tzOffset).toFixed(1)}`;

  const onGridClick = (e: React.MouseEvent) => {
    const el = hoursRef.current;
    if (!el) return;
    // The content rect moves with the scroll, so clientY - top is already in
    // canvas coordinates.
    const y = e.clientY - el.getBoundingClientRect().top;
    const minutes = Math.min(23 * 60 + 30, Math.max(0, Math.floor((y / HOUR_HEIGHT) * 2) * 30));
    onCreateAt(hm(minutes));
  };

  const chipStyle = (color: string | undefined) =>
    ({ '--block-color': color }) as React.CSSProperties;

  return (
    <div className="calendar-day-view">
      <div className="calendar-day-head">
        <span className="calendar-day-tz">{tzLabel}</span>
        <div className="calendar-day-head-main">
          <div className="calendar-day-title">
            <span className="calendar-day-weekday">{weekdayShort}</span>
            <span className={`calendar-day-number ${isToday ? 'calendar-day-number--today' : ''}`}>{dayNumber}</span>
          </div>
          <div className="calendar-day-allday">
            {allDayEvents.map(e => (
              <button
                key={e.id}
                type="button"
                className="calendar-day-chip"
                style={chipStyle(blockColor(e.labels))}
                onClick={() => onOpenEvent(e)}
              >
                {e.title}
              </button>
            ))}
            {allDayTasks.map(task => (
              <span
                key={task.id}
                className={`calendar-day-chip calendar-day-chip--task ${task.status !== 'open' ? 'calendar-day-chip--done' : ''}`}
                style={chipStyle(blockColor(task.labels))}
              >
                <input
                  type="checkbox"
                  checked={task.status === 'done'}
                  onChange={() => onToggleTask(task)}
                  aria-label={t('calendar.task')}
                />
                <button type="button" className="calendar-day-chip-title" onClick={() => onOpenTask(task)}>
                  {task.title}
                </button>
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="calendar-day-scroll" ref={scrollRef}>
        <div
          className="calendar-day-hours"
          ref={hoursRef}
          style={{ height: 24 * HOUR_HEIGHT, '--calendar-gutter': `${GUTTER}px` } as React.CSSProperties}
          onClick={onGridClick}
        >
          {Array.from({ length: 24 }, (_, h) => (
            <div key={h} className="calendar-hour" style={{ top: h * HOUR_HEIGHT }}>
              <span className="calendar-hour-label">{hourFmt.format(new Date(2024, 0, 1, h))}</span>
            </div>
          ))}
          {timed.map(({ kind, item, start, end, col, cols }) => {
            const task = kind === 'task' ? (item as Task) : null;
            const event = kind === 'event' ? (item as CalendarEvent) : null;
            const done = task !== null && task.status !== 'open';
            return (
              <div
                key={`${kind}-${item.id}`}
                className={`calendar-day-block ${task ? 'calendar-day-block--task' : ''} ${done ? 'calendar-day-block--done' : ''}`}
                style={{
                  top: (start / 1440) * 24 * HOUR_HEIGHT,
                  height: Math.max(((end - start) / 1440) * 24 * HOUR_HEIGHT, 20),
                  left: `calc(var(--calendar-gutter) + ${col * 100 / cols}%)`,
                  width: `calc(${100 / cols}% - 4px)`,
                  ...chipStyle(blockColor((task ?? event)?.labels)),
                } as React.CSSProperties}
                role="button"
                tabIndex={0}
                onClick={e => { e.stopPropagation(); task ? onOpenTask(task) : event && onOpenEvent(event); }}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.stopPropagation();
                    task ? onOpenTask(task) : event && onOpenEvent(event);
                  }
                }}
              >
                {task && (
                  <input
                    type="checkbox"
                    className="calendar-day-block-check"
                    checked={task.status === 'done'}
                    onChange={() => onToggleTask(task)}
                    onClick={e => e.stopPropagation()}
                    aria-label={t('calendar.task')}
                  />
                )}
                <span className="calendar-day-block-title">{item.title}</span>
                <span className="calendar-day-block-time">{hm(start)} – {hm(end)}</span>
              </div>
            );
          })}
          {isToday && (
            <div className="calendar-now-line" style={{ top: (nowMinutes / 1440) * 24 * HOUR_HEIGHT }}>
              <span className="calendar-now-dot" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Create/edit modal, shared by every view. `event` null = create; `initialStart`
// prefills the time field when creating from a clicked grid slot.
function EventModal({ initialDate, initialStart, event, onClose, onSaved }: {
  initialDate: string;
  initialStart?: string;
  event: CalendarEvent | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useLanguage();
  const [title, setTitle] = useState(event?.title ?? '');
  const [date, setDate] = useState(event?.event_date ?? initialDate);
  const [start, setStart] = useState(event?.start_time ?? initialStart ?? '');
  const [end, setEnd] = useState(event?.end_time ?? '');
  const [labelIds, setLabelIds] = useState<string[]>(event?.labels?.map(l => l.id) ?? []);
  const [pickedLabels, setPickedLabels] = useState<Label[]>(event?.labels ?? []);
  const [labelPickerOpen, setLabelPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const isNew = !event;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !confirmDelete) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [confirmDelete, onClose]);

  const save = async () => {
    if (!title.trim()) { setError(t('calendar.titleRequired')); return; }
    if (start && end && end < start) { setError(t('calendar.actionError')); return; }
    setSaving(true);
    setError(null);
    try {
      const payload = { title: title.trim(), event_date: date, start_time: start || null, end_time: end || null, label_ids: labelIds };
      if (isNew) await api.events.create(payload);
      else await api.events.update(event.id, payload);
      onSaved();
    } catch (err) {
      console.error('Failed to save event', err);
      setError(t('calendar.actionError'));
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!event) return;
    setSaving(true);
    try {
      await api.events.remove(event.id);
      onSaved();
    } catch (err) {
      console.error('Failed to delete event', err);
      setError(t('calendar.actionError'));
      setSaving(false);
      setConfirmDelete(false);
    }
  };

  return createPortal(
    <>
      <div className="event-modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !confirmDelete) onClose(); }}>
        <div className="event-modal" role="dialog" aria-modal="true" aria-label={isNew ? t('calendar.newEvent') : t('calendar.editEvent')}>
          <div className="event-modal-header">
            <span className="event-modal-title">
              <CalendarIcon size={15} /> {isNew ? t('calendar.newEvent') : t('calendar.editEvent')}
            </span>
            <button type="button" className="event-modal-close" onClick={onClose} aria-label="Close">
              <XIcon size={15} />
            </button>
          </div>

          <div className="event-modal-body">
            <label className="event-modal-field">
              <span>{t('calendar.eventTitle')}</span>
              <input
                autoFocus
                type="text"
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder={t('calendar.eventTitlePlaceholder')}
                maxLength={500}
              />
            </label>
            <label className="event-modal-field">
              <span>{t('calendar.date')}</span>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} required />
            </label>
            <div className="event-modal-times">
              <label className="event-modal-field">
                <span>{t('calendar.startTime')}</span>
                <input type="time" value={start} onChange={e => setStart(e.target.value)} />
              </label>
              <label className="event-modal-field">
                <span>{t('calendar.endTime')}</span>
                <input type="time" value={end} onChange={e => setEnd(e.target.value)} />
              </label>
            </div>
            {!start && <div className="event-modal-hint">{t('calendar.allDay')}</div>}
            <div className="event-modal-labels">
              {pickedLabels.map(l => (
                <LabelChip key={l.id} label={l} />
              ))}
              <button type="button" className="label-chip label-chip--add" onClick={() => setLabelPickerOpen(true)}>
                {t('labels.editLabels')}
              </button>
            </div>
            {error && <div className="event-modal-error" role="alert">{error}</div>}
          </div>

          <div className="event-modal-footer">
            {!isNew && (
              <button type="button" className="event-modal-delete" onClick={() => setConfirmDelete(true)}>
                {t('calendar.deleteEvent')}
              </button>
            )}
            <button type="button" className="event-modal-cancel" onClick={onClose}>{t('dialog.cancel')}</button>
            <button type="button" className="event-modal-save" onClick={save} disabled={saving}>
              {t('common.save')}
            </button>
          </div>
        </div>
      </div>

      <LabelPickerModal
        open={labelPickerOpen}
        onClose={() => setLabelPickerOpen(false)}
        selected={labelIds}
        onApply={(ids, labels) => { setLabelIds(ids); setPickedLabels(labels); }}
      />

      <ConfirmDialog
        open={confirmDelete}
        title={t('calendar.confirmDeleteTitle', { title: event?.title || t('calendar.eventTitlePlaceholder') })}
        description={t('calendar.confirmDeleteBody')}
        confirmLabel={t('calendar.deleteEvent')}
        confirmTone="danger"
        loading={saving}
        onConfirm={remove}
        onCancel={() => { if (!saving) setConfirmDelete(false); }}
      />
    </>,
    document.body
  );
}
