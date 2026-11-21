// Shared label picker: lists the user's labels, lets them create a new one and
// returns the checked ids. It never writes an item itself — the caller decides
// when to save (plan-06 LB5).

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, ApiError } from '../api/client';
import type { Label } from '../types';
import { useLanguage } from '../i18n/LanguageContext';
import { notifyLabelsChanged } from '../utils/workspaceStorage';
import { XIcon } from './Icons';

interface Props {
  open: boolean;
  onClose: () => void;
  selected: string[];
  onApply: (ids: string[]) => void;
}

export function LabelPickerModal({ open, onClose, selected, onApply }: Props) {
  const { t } = useLanguage();
  const [labels, setLabels] = useState<Label[]>([]);
  const [ids, setIds] = useState<string[]>(selected);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const selectedKey = selected.join('|');

  useEffect(() => {
    if (!open) return;
    setIds(selected);
    setName('');
    setError(null);
    setLoading(true);
    api.labels.list()
      .then(res => setLabels(res.labels))
      .catch(err => {
        console.error('Failed to load labels', err);
        setError(t('labels.loadError'));
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, selectedKey]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const toggle = (id: string) => {
    setIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setCreating(true);
    setError(null);
    try {
      const res = await api.labels.create(trimmed);
      setLabels(prev => [...prev, res.label].sort((a, b) => a.name.localeCompare(b.name)));
      setIds(prev => [...prev, res.label.id]);
      setName('');
      notifyLabelsChanged();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) setError(t('labels.duplicate'));
      else {
        console.error('Failed to create label', err);
        setError(t('tasks.actionError'));
      }
    } finally {
      setCreating(false);
    }
  };

  return createPortal(
    <div className="event-modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="event-modal" role="dialog" aria-modal="true" aria-label={t('labels.editLabels')}>
        <div className="event-modal-header">
          <span className="event-modal-title">{t('labels.editLabels')}</span>
          <button type="button" className="event-modal-close" onClick={onClose} aria-label="Close">
            <XIcon size={15} />
          </button>
        </div>

        <div className="event-modal-body">
          {loading ? (
            <div className="label-picker-empty">…</div>
          ) : labels.length === 0 ? (
            <div className="label-picker-empty">{t('labels.emptyView')}</div>
          ) : (
            <div className="label-picker-list">
              {labels.map(label => (
                <label key={label.id} className="label-picker-item">
                  <input
                    type="checkbox"
                    checked={ids.includes(label.id)}
                    onChange={() => toggle(label.id)}
                  />
                  <span>{label.name}</span>
                </label>
              ))}
            </div>
          )}

          <div className="label-picker-create">
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder={t('labels.namePlaceholder')}
              maxLength={40}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); create(); } }}
            />
            <button type="button" className="label-picker-create-btn" onClick={create} disabled={creating || !name.trim()}>
              {t('labels.create')}
            </button>
          </div>
          {error && <div className="event-modal-error" role="alert">{error}</div>}
        </div>

        <div className="event-modal-footer">
          <button
            type="button"
            className="event-modal-save"
            onClick={() => { onApply(ids); onClose(); }}
          >
            {t('labels.apply')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
