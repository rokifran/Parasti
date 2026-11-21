// One label and everything that carries it, grouped by item type (plan-06
// LB4). Pages open the editor, tasks open TaskEditModal, events go to the
// calendar (editing an event only happens there).

import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import type { CalendarEvent, Label, Task } from '../types';
import { LABEL_COLORS } from '../../server/shared/labels';
import { todayIn, addDays } from '../../server/shared/tasks';
import { useConfig } from '../contexts/ConfigContext';
import { useLanguage } from '../i18n/LanguageContext';
import { notifyLabelsChanged } from '../utils/workspaceStorage';
import { ConfirmDialog } from './ConfirmDialog';
import { TaskEditModal } from './TaskEditModal';
import { LabelChip } from './LabelChip';
import { LabelColorPalette } from './LabelColorPalette';
import { LoaderIcon, TagIcon } from './Icons';

interface LabelItems {
  label: Label;
  pages: Array<{ id: string; title: string; icon: string }>;
  tasks: Task[];
  events: CalendarEvent[];
}

export function LabelViewPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { config } = useConfig();
  const tomorrow = addDays(todayIn(config.timezone), 1);

  const [data, setData] = useState<LabelItems | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState('');
  const [color, setColor] = useState<string | null>(null);
  const [savingName, setSavingName] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);

  const load = useCallback(() => {
    if (!id) return;
    setLoading(true);
    setError(null);
    api.labels.items(id)
      .then(res => {
        setData(res);
        setName(res.label.name);
        setColor(res.label.color ?? null);
        setNotFound(false);
      })
      .catch(err => {
        console.error('Failed to load label', err);
        if (err instanceof ApiError && err.status === 404) setNotFound(true);
        else setError(t('labels.loadError'));
      })
      .finally(() => setLoading(false));
  }, [id, t]);

  useEffect(() => load(), [load]);

  const startRename = () => {
    if (!data) return;
    setName(data.label.name);
    setColor(data.label.color ?? null);
    setRenameError(null);
    setRenaming(true);
  };

  const saveRename = async () => {
    if (!data) return;
    const trimmed = name.trim();
    if (!trimmed) { setRenameError(t('labels.namePlaceholder')); return; }
    setSavingName(true);
    setRenameError(null);
    try {
      const res = await api.labels.rename(data.label.id, trimmed, color);
      setData(prev => {
        if (!prev) return prev;
        const patch = (l: Label) => (l.id === res.label.id ? { ...l, name: res.label.name, color: res.label.color } : l);
        return {
          ...prev,
          label: res.label,
          tasks: prev.tasks.map(task => ({ ...task, labels: task.labels.map(patch) })),
          events: prev.events.map(event => ({ ...event, labels: event.labels.map(patch) })),
        };
      });
      setRenaming(false);
      notifyLabelsChanged();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) setRenameError(t('labels.duplicate'));
      else {
        console.error('Failed to rename label', err);
        setRenameError(t('tasks.actionError'));
      }
    } finally {
      setSavingName(false);
    }
  };

  const remove = async () => {
    if (!data) return;
    setDeleting(true);
    try {
      await api.labels.remove(data.label.id);
      notifyLabelsChanged();
      navigate('/');
    } catch (err) {
      console.error('Failed to delete label', err);
      setError(t('tasks.actionError'));
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  if (notFound) {
    return <div className="tasks-page"><div className="tasks-empty">{t('labels.notFound')}</div></div>;
  }

  if (loading) {
    return <div className="tasks-page"><div className="tasks-empty">…</div></div>;
  }

  if (error || !data) {
    return <div className="tasks-page"><div className="tasks-error" role="alert">{error ?? t('labels.loadError')}</div></div>;
  }

  const total = data.pages.length + data.tasks.length + data.events.length;

  return (
    <div className="tasks-page">
      <header className="tasks-header">
        <h1 className="tasks-title">
          <TagIcon size={18} />
          {data.label.color && (LABEL_COLORS as readonly string[]).includes(data.label.color) && (
            <span className={`label-dot label-dot--${data.label.color}`} aria-hidden="true" />
          )}
          {data.label.name}
        </h1>
        <div className="label-view-actions">
          <button type="button" className="tasks-tab" onClick={startRename}>{t('labels.rename')}</button>
          <button type="button" className="tasks-tab" onClick={() => setConfirmDelete(true)}>{t('labels.delete')}</button>
        </div>
      </header>

      {renaming && (
        <div className="tasks-form label-view-rename">
          <input
            autoFocus
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder={t('labels.renameLabel')}
            maxLength={40}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); saveRename(); }
              if (e.key === 'Escape') setRenaming(false);
            }}
          />
          <LabelColorPalette value={color} onChange={setColor} />
          <button type="button" className="tasks-add-btn" onClick={saveRename} disabled={savingName}>
            {savingName ? <LoaderIcon size={14} /> : t('common.save')}
          </button>
          <button type="button" className="tasks-tab" onClick={() => setRenaming(false)} disabled={savingName}>
            {t('common.cancel')}
          </button>
          {renameError && <div className="tasks-error" role="alert">{renameError}</div>}
        </div>
      )}

      {error && <div className="tasks-error" role="alert">{error}</div>}

      {total === 0 ? (
        <div className="tasks-empty">{t('labels.emptyView')}</div>
      ) : (
        <>
          {data.pages.length > 0 && (
            <section className="label-view-section">
              <h2 className="label-view-section-title">{t('labels.itemsPages')}</h2>
              <ul className="tasks-list">
                {data.pages.map(page => (
                  <li key={page.id} className="tasks-row">
                    <button
                      type="button"
                      className="tasks-row-title"
                      onClick={() => navigate(`/page/${page.id}`)}
                    >
                      {page.icon ? `${page.icon} ` : ''}{page.title || t('sidebar.untitledPage')}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {data.tasks.length > 0 && (
            <section className="label-view-section">
              <h2 className="label-view-section-title">{t('labels.itemsTasks')}</h2>
              <ul className="tasks-list">
                {data.tasks.map(task => (
                  <li
                    key={task.id}
                    className={`tasks-row tasks-row--${task.bucket}${task.due_date === tomorrow && task.bucket === 'upcoming' ? ' tasks-row--h1' : ''}`}
                  >
                    <button
                      type="button"
                      className={`tasks-row-title${task.priority === 'high' ? ' tasks-row-title--high' : ''}${task.priority === 'low' ? ' tasks-row-title--low' : ''}`}
                      onClick={() => setEditing(task)}
                    >
                      {task.priority === 'high' && <span className="task-prio-flag" aria-hidden="true">❗</span>}
                      {task.title}
                    </button>
                    {task.labels?.map(l => (
                      <LabelChip key={l.id} label={l} />
                    ))}
                    <span className="tasks-row-date">
                      {task.due_date}{task.due_time ? ` · ${task.due_time}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {data.events.length > 0 && (
            <section className="label-view-section">
              <h2 className="label-view-section-title">{t('labels.itemsEvents')}</h2>
              <ul className="tasks-list">
                {data.events.map(event => (
                  <li key={event.id} className="tasks-row">
                    <button
                      type="button"
                      className="tasks-row-title"
                      onClick={() => navigate('/calendar')}
                    >
                      {event.title}
                    </button>
                    <span className="tasks-row-date">
                      {event.event_date}{event.start_time ? ` · ${event.start_time}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      {editing && (
        <TaskEditModal
          task={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}

      <ConfirmDialog
        open={confirmDelete}
        title={t('labels.deleteConfirmTitle', { name: data.label.name })}
        description={t('labels.deleteConfirmBody')}
        confirmLabel={t('labels.delete')}
        confirmTone="danger"
        loading={deleting}
        onConfirm={remove}
        onCancel={() => { if (!deleting) setConfirmDelete(false); }}
      />
    </div>
  );
}
