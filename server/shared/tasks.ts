// Shared task rules. Both backends (server/index.ts and
// functions/api/[[route]].ts) call these so validation, "today" and the list
// buckets stay identical.

export const TASK_STATUSES = ['open', 'done', 'cancelled'] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ['high', 'normal', 'low'] as const;

export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export interface TaskInput {
  title?: string;
  due_date?: string;
  due_time?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  page_id?: string | null;
}

export type TaskValidation = { error: string } | { value: TaskInput };

export type TaskBucket = 'overdue' | 'today' | 'upcoming' | 'done' | 'cancelled';

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
const HM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// A real calendar date: the regex only checks the shape, so 2026-02-30 would
// otherwise slip through. Round-tripping through UTC catches that.
export function isValidYmd(s: string): boolean {
  if (!YMD_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function isValidHm(s: string): boolean {
  return HM_RE.test(s);
}

// The institution's "today", independent of the server's own timezone
// (Cloudflare runs in UTC). `en-CA` yields YYYY-MM-DD.
export function todayIn(timeZone: string, now: number = Date.now()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(now));
}

// Pure calendar arithmetic in UTC, so no local-time DST can shift the result.
export function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + n));
  const yy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

// Validates the body of POST /tasks (partial = false) and PATCH /tasks/:id
// (partial = true). Fields absent from the body are absent from `value`, which
// is what makes PATCH partial.
export function validateTaskInput(body: unknown, partial: boolean): TaskValidation {
  const b = (body || {}) as Record<string, unknown>;
  const value: TaskInput = {};

  if (!partial || b.title !== undefined) {
    const title = typeof b.title === 'string' ? b.title.trim() : '';
    if (!title) return { error: 'Title is required' };
    if (title.length > 200) return { error: 'Title is too long' };
    value.title = title;
  }

  if (!partial || b.due_date !== undefined) {
    const dueDate = typeof b.due_date === 'string' ? b.due_date : '';
    if (!isValidYmd(dueDate)) return { error: 'Invalid due date' };
    value.due_date = dueDate;
  }

  // An explicit empty/null value clears the time; an absent key leaves it
  // untouched on PATCH. On create, absent means all-day (null).
  if (!partial || b.due_time !== undefined) {
    if (b.due_time == null || b.due_time === '') {
      value.due_time = null;
    } else if (typeof b.due_time === 'string' && isValidHm(b.due_time)) {
      value.due_time = b.due_time;
    } else {
      return { error: 'Invalid due time' };
    }
  }

  if (b.status !== undefined) {
    if (typeof b.status !== 'string' || !(TASK_STATUSES as readonly string[]).includes(b.status)) {
      return { error: 'Invalid status' };
    }
    value.status = b.status as TaskStatus;
  }

  if (b.priority !== undefined) {
    if (
      typeof b.priority !== 'string' ||
      !(TASK_PRIORITIES as readonly string[]).includes(b.priority)
    ) {
      return { error: 'Invalid priority' };
    }
    value.priority = b.priority as TaskPriority;
  }

  if (!partial || b.page_id !== undefined) {
    if (b.page_id == null || b.page_id === '') {
      value.page_id = null;
    } else if (typeof b.page_id === 'string') {
      value.page_id = b.page_id;
    } else {
      return { error: 'Invalid page' };
    }
  }

  return { value };
}

export function taskBucket(
  task: { due_date: string; status: string },
  today: string
): TaskBucket {
  if (task.status === 'done') return 'done';
  if (task.status === 'cancelled') return 'cancelled';
  if (task.due_date < today) return 'overdue';
  if (task.due_date === today) return 'today';
  return 'upcoming';
}
