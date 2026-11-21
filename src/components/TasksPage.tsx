// Tasks page: four bucket tabs (overdue / today / upcoming / done) over the
// /api/tasks CRUD. "Today" always follows the institution's TIMEZONE, not the
// browser's or the server's clock.

import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import type { Task } from '../types';
import { useConfig } from '../contexts/ConfigContext';
import { useLanguage } from '../i18n/LanguageContext';
import { ConfirmDialog } from './ConfirmDialog';
import { TaskEditModal } from './TaskEditModal';
import { CheckIcon, CheckSquareIcon, LoaderIcon, PlusIcon, TrashIcon } from './Icons';

type Tab = 'overdue' | 'today' | 'upcoming' | 'done';

const TABS: Tab[] = ['overdue', 'today', 'upcoming', 'done'];

function ymdIn(timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export function TasksPage() {
  const { t, language } = useLanguage();
  const { config } = useConfig();
  const [tab, setTab] = useState<Tab>('today');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState(() => ymdIn(config.timezone));
  const [dueTime, setDueTime] = useState('');
  const [adding, setAdding] = useState(false);

  const [editing, setEditing] = useState<Task | null>(null);
  const [deleting, setDeleting] = useState<Task | null>(null);
  const [removing, setRemoving] = useState(false);

  // Keep the default date correct if config arrives after the first render.
  useEffect(() => {
    setDueDate(ymdIn(config.timezone));
  }, [config.timezone]);

  const reload = useCallback(() => {
    let active = true;
    setLoading(true);
    setError(null);
    const params = tab === 'done'
      ? { due: 'all', status: 'done' }
      : { due: tab };
    api.tasks.list(params)
      .then(res => { if (active) setTasks(res.tasks); })
      .catch(err => {
        console.error('Failed to load tasks', err);
        if (active) setError(t('tasks.loadError'));
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  useEffect(() => reload(), [reload]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) { setError(t('tasks.titleRequired')); return; }
    setAdding(true);
    setError(null);
    try {
      await api.tasks.create({
        title: title.trim(),
        due_date: dueDate,
        due_time: dueTime || null,
      });
      setTitle('');
      setDueTime('');
      reload();
    } catch (err) {
      console.error('Failed to create task', err);
      setError(t('tasks.actionError'));
    } finally {
      setAdding(false);
    }
  };

  const toggle = async (task: Task) => {
    setError(null);
    try {
      await api.tasks.update(task.id, { status: task.status === 'done' ? 'open' : 'done' });
      reload();
    } catch (err) {
      console.error('Failed to update task', err);
      setError(t('tasks.actionError'));
    }
  };

  const remove = async () => {
    if (!deleting) return;
    setRemoving(true);
    try {
      await api.tasks.remove(deleting.id);
      setDeleting(null);
      reload();
    } catch (err) {
      console.error('Failed to delete task', err);
      setError(t('tasks.actionError'));
      setDeleting(null);
    } finally {
      setRemoving(false);
    }
  };

  const formatDue = (task: Task) => {
    const d = new Date(`${task.due_date}T00:00:00Z`);
    const date = isNaN(d.getTime())
      ? task.due_date
      : new Intl.DateTimeFormat(language, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(d);
    return task.due_time ? `${date} · ${task.due_time}` : date;
  };

  return (
    <div className="tasks-page">
      <header className="tasks-header">
        <h1 className="tasks-title"><CheckSquareIcon size={18} /> {t('tasks.title')}</h1>
        <div className="tasks-tabs" role="tablist">
          {TABS.map(v => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={tab === v}
              className={`tasks-tab ${tab === v ? 'active' : ''}`}
              onClick={() => setTab(v)}
            >
              {t(`tasks.tab.${v}`)}
            </button>
          ))}
        </div>
      </header>

      <form className="tasks-form" onSubmit={add}>
        <input
          className="tasks-form-title"
          type="text"
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder={t('tasks.titlePlaceholder')}
          maxLength={200}
          aria-label={t('tasks.titleLabel')}
        />
        <input
          type="date"
          value={dueDate}
          onChange={e => setDueDate(e.target.value)}
          aria-label={t('tasks.dueDate')}
          required
        />
        <input
          type="time"
          value={dueTime}
          onChange={e => setDueTime(e.target.value)}
          aria-label={t('tasks.timeOptional')}
        />
        <button type="submit" className="tasks-add-btn" disabled={adding}>
          {adding ? <LoaderIcon size={14} /> : <PlusIcon size={14} />}
          {t('tasks.add')}
        </button>
      </form>

      {error && <div className="tasks-error" role="alert">{error}</div>}

      {loading ? (
        <div className="tasks-empty">…</div>
      ) : tasks.length === 0 ? (
        <div className="tasks-empty">{t('tasks.noTasks')}</div>
      ) : (
        <ul className="tasks-list">
          {tasks.map(task => {
            const isDone = task.status === 'done';
            return (
              <li key={task.id} className={`tasks-row ${isDone ? 'tasks-row--done' : ''} tasks-row--${task.bucket}`}>
                <button
                  type="button"
                  className={`tasks-check ${isDone ? 'tasks-check--done' : ''}`}
                  role="checkbox"
                  aria-checked={isDone}
                  aria-label={isDone ? t('tasks.markOpen') : t('tasks.markDone')}
                  onClick={() => toggle(task)}
                >
                  {isDone && <CheckIcon size={12} />}
                </button>
                <button
                  type="button"
                  className={`tasks-row-title${task.priority === 'high' ? ' tasks-row-title--high' : ''}${task.priority === 'low' ? ' tasks-row-title--low' : ''}`}
                  onClick={() => setEditing(task)}
                >
                  {task.priority === 'high' && <span className="task-prio-flag" aria-hidden="true">❗</span>}
                  {task.title}
                </button>
                {task.labels?.map(l => (
                  <span key={l.id} className="label-chip label-chip--static">{l.name}</span>
                ))}
                <span className="tasks-row-date">{formatDue(task)}</span>
                <button
                  type="button"
                  className="tasks-row-delete"
                  onClick={() => setDeleting(task)}
                  title={t('tasks.deleteTask')}
                  aria-label={t('tasks.deleteTask')}
                >
                  <TrashIcon size={15} />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {editing && (
        <TaskEditModal
          task={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); reload(); }}
        />
      )}

      <ConfirmDialog
        open={!!deleting}
        title={t('tasks.confirmDeleteTitle', { title: deleting?.title || '' })}
        description={t('tasks.confirmDeleteBody')}
        confirmLabel={t('tasks.deleteTask')}
        confirmTone="danger"
        loading={removing}
        onConfirm={remove}
        onCancel={() => { if (!removing) setDeleting(null); }}
      />
    </div>
  );
}
