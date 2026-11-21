// Edit modal for one task. Same portal/escape/backdrop pattern as the calendar
// event modal (and ApiTokenModal), with a confirmation step for deletion.

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api/client';
import type { Task } from '../types';
import { useLanguage } from '../i18n/LanguageContext';
import { ConfirmDialog } from './ConfirmDialog';
import { CheckSquareIcon, LoaderIcon, XIcon } from './Icons';

interface Props {
  task: Task;
  onClose: () => void;
  onSaved: () => void;
}

export function TaskEditModal({ task, onClose, onSaved }: Props) {
  const { t } = useLanguage();
  const [title, setTitle] = useState(task.title);
  const [dueDate, setDueDate] = useState(task.due_date);
  const [dueTime, setDueTime] = useState(task.due_time ?? '');
  const [status, setStatus] = useState<Task['status']>(task.status);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !confirmDelete) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [confirmDelete, onClose]);

  const save = async () => {
    if (!title.trim()) { setError(t('tasks.titleRequired')); return; }
    setSaving(true);
    setError(null);
    try {
      await api.tasks.update(task.id, {
        title: title.trim(),
        due_date: dueDate,
        due_time: dueTime || null,
        status,
      });
      onSaved();
    } catch (err) {
      console.error('Failed to save task', err);
      setError(t('tasks.actionError'));
      setSaving(false);
    }
  };

  const remove = async () => {
    setSaving(true);
    try {
      await api.tasks.remove(task.id);
      onSaved();
    } catch (err) {
      console.error('Failed to delete task', err);
      setError(t('tasks.actionError'));
      setSaving(false);
      setConfirmDelete(false);
    }
  };

  return createPortal(
    <>
      <div className="event-modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !confirmDelete) onClose(); }}>
        <div className="event-modal" role="dialog" aria-modal="true" aria-label={t('tasks.editTask')}>
          <div className="event-modal-header">
            <span className="event-modal-title">
              <CheckSquareIcon size={15} /> {t('tasks.editTask')}
            </span>
            <button type="button" className="event-modal-close" onClick={onClose} aria-label="Close">
              <XIcon size={15} />
            </button>
          </div>

          <div className="event-modal-body">
            <label className="event-modal-field">
              <span>{t('tasks.titleLabel')}</span>
              <input
                autoFocus
                type="text"
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder={t('tasks.titlePlaceholder')}
                maxLength={200}
              />
            </label>
            <label className="event-modal-field">
              <span>{t('tasks.dueDate')}</span>
              <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} required />
            </label>
            <div className="event-modal-times">
              <label className="event-modal-field">
                <span>{t('tasks.timeOptional')}</span>
                <input type="time" value={dueTime} onChange={e => setDueTime(e.target.value)} />
              </label>
              <label className="event-modal-field">
                <span>{t('tasks.status')}</span>
                <select value={status} onChange={e => setStatus(e.target.value as Task['status'])}>
                  <option value="open">{t('tasks.statusOpen')}</option>
                  <option value="done">{t('tasks.statusDone')}</option>
                  <option value="cancelled">{t('tasks.statusCancelled')}</option>
                </select>
              </label>
            </div>
            {error && <div className="event-modal-error" role="alert">{error}</div>}
          </div>

          <div className="event-modal-footer">
            <button type="button" className="event-modal-delete" onClick={() => setConfirmDelete(true)}>
              {t('tasks.deleteTask')}
            </button>
            <button type="button" className="event-modal-cancel" onClick={onClose}>{t('common.cancel')}</button>
            <button type="button" className="event-modal-save" onClick={save} disabled={saving}>
              {saving ? <LoaderIcon size={14} /> : t('common.save')}
            </button>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title={t('tasks.confirmDeleteTitle', { title: title.trim() || t('tasks.titlePlaceholder') })}
        description={t('tasks.confirmDeleteBody')}
        confirmLabel={t('tasks.deleteTask')}
        confirmTone="danger"
        loading={saving}
        onConfirm={remove}
        onCancel={() => { if (!saving) setConfirmDelete(false); }}
      />
    </>,
    document.body
  );
}
