// Modal create label, dibuka dari tombol "+" bagian Labels di sidebar.

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, ApiError } from '../api/client';
import { useLanguage } from '../i18n/LanguageContext';
import { notifyLabelsChanged } from '../utils/workspaceStorage';
import { LabelColorPalette } from './LabelColorPalette';
import { LabelChip } from './LabelChip';
import { LoaderIcon, XIcon } from './Icons';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function LabelCreateModal({ open, onClose }: Props) {
  const { t } = useLanguage();
  const [name, setName] = useState('');
  const [color, setColor] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName('');
    setColor(null);
    setError(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaving(true);
    setError(null);
    try {
      await api.labels.create(trimmed, color);
      notifyLabelsChanged();
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) setError(t('labels.duplicate'));
      else {
        console.error('Failed to create label', err);
        setError(t('tasks.actionError'));
      }
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div className="event-modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="event-modal" role="dialog" aria-modal="true" aria-label={t('labels.newLabel')}>
        <div className="event-modal-header">
          <span className="event-modal-title">{t('labels.newLabel')}</span>
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
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); create(); } }}
            />
          </label>
          <LabelColorPalette value={color} onChange={setColor} />
          <div className="event-modal-labels">
            <LabelChip label={{ id: 'preview', name: name.trim() || t('labels.namePlaceholder'), color }} />
          </div>
          {error && <div className="event-modal-error" role="alert">{error}</div>}
        </div>

        <div className="event-modal-footer">
          <button type="button" className="event-modal-cancel" onClick={onClose}>{t('common.cancel')}</button>
          <button type="button" className="event-modal-save" onClick={create} disabled={saving || !name.trim()}>
            {saving ? <LoaderIcon size={14} /> : t('labels.create')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
