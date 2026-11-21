// Edit-label modal, opened from the pencil button on each sidebar label row.

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, ApiError } from '../api/client';
import type { Label } from '../types';
import { useLanguage } from '../i18n/LanguageContext';
import { notifyLabelsChanged } from '../utils/workspaceStorage';
import { LabelColorPalette } from './LabelColorPalette';
import { LabelChip } from './LabelChip';
import { LoaderIcon, XIcon } from './Icons';

interface Props {
  label: Label | null;
  onClose: () => void;
}

export function LabelEditModal({ label, onClose }: Props) {
  const { t } = useLanguage();
  const [name, setName] = useState(label?.name ?? '');
  const [color, setColor] = useState<string | null>(label?.color ?? null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!label) return;
    setName(label.name);
    setColor(label.color ?? null);
    setError(null);
  }, [label]);

  useEffect(() => {
    if (!label) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [label, onClose]);

  if (!label) return null;

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaving(true);
    setError(null);
    try {
      await api.labels.rename(label.id, trimmed, color);
      notifyLabelsChanged();
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) setError(t('labels.duplicate'));
      else {
        console.error('Failed to edit label', err);
        setError(t('tasks.actionError'));
      }
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div className="event-modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="event-modal" role="dialog" aria-modal="true" aria-label={t('labels.editLabel')}>
        <div className="event-modal-header">
          <span className="event-modal-title">{t('labels.editLabel')}</span>
          <button type="button" className="event-modal-close" onClick={onClose} aria-label="Close">
            <XIcon size={15} />
          </button>
        </div>

        <div className="event-modal-body">
          <label className="event-modal-field">
            <span>{t('labels.renameLabel')}</span>
            <input
              autoFocus
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder={t('labels.namePlaceholder')}
              maxLength={40}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); save(); } }}
            />
          </label>
          <LabelColorPalette value={color} onChange={setColor} />
          <div className="event-modal-labels">
            <LabelChip label={{ id: label.id, name: name.trim() || t('labels.namePlaceholder'), color }} />
          </div>
          {error && <div className="event-modal-error" role="alert">{error}</div>}
        </div>

        <div className="event-modal-footer">
          <button type="button" className="event-modal-cancel" onClick={onClose}>{t('common.cancel')}</button>
          <button type="button" className="event-modal-save" onClick={save} disabled={saving || !name.trim()}>
            {saving ? <LoaderIcon size={14} /> : t('common.save')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
