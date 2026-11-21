// Create modal for a page or project, with an optional title and icon. Shared
// by every creation entry point so the icon can be chosen before the page is
// created (plan-08).

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api/client';
import { usePageContext } from '../contexts/PageContext';
import { useLanguage } from '../i18n/LanguageContext';
import { IconPicker } from './IconPicker';
import { LoaderIcon, PlusIcon, XIcon } from './Icons';

export interface NewPageRequest {
  kind: 'page' | 'project';
  parentId?: string | null;
  insertSubpageBlock?: boolean;
}

interface Props {
  request: NewPageRequest | null;
  onClose: () => void;
}

export function NewPageModal({ request, onClose }: Props) {
  const { t } = useLanguage();
  const { createPage, updatePage, refreshPages } = usePageContext();
  const [title, setTitle] = useState('');
  const [icon, setIcon] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerAnchor, setPickerAnchor] = useState<DOMRect | null>(null);
  const iconBtnRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!request) return;
    setTitle(request.kind === 'project' ? 'New Project' : '');
    setIcon('');
    setSaving(false);
    setError(null);
    setPickerOpen(false);
  }, [request]);

  useEffect(() => {
    if (!request) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !pickerOpen) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [request, pickerOpen, onClose]);

  if (!request) return null;

  const openPicker = () => {
    if (iconBtnRef.current) setPickerAnchor(iconBtnRef.current.getBoundingClientRect());
    setPickerOpen(true);
  };

  const create = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const page = await createPage(request.parentId ?? null, {
        title: title.trim() || undefined,
        icon,
      });
      if (request.kind === 'project') {
        await updatePage(page.id, { is_project: true });
      }
      if (request.insertSubpageBlock && request.parentId) {
        try {
          await api.blocks.create(request.parentId, {
            type: 'subpage',
            content: page.id,
            position: 999_999,
          });
        } catch (e) {
          console.error('Failed to insert inline subpage block', e);
        }
      }
      await refreshPages();
      onClose();
    } catch (err) {
      console.error('Failed to create page', err);
      setError(t('page.createError'));
    } finally {
      setSaving(false);
    }
  };

  const modalTitle = request.kind === 'project' ? t('sidebar.newProject') : t('sidebar.newPage');

  return createPortal(
    <div
      className="event-modal-backdrop"
      onMouseDown={(e) => { if (e.target === e.currentTarget && !saving) onClose(); }}
    >
      <div className="event-modal" role="dialog" aria-modal="true" aria-label={modalTitle}>
        <div className="event-modal-header">
          <span className="event-modal-title">{modalTitle}</span>
          <button type="button" className="event-modal-close" onClick={onClose} aria-label="Close">
            <XIcon size={15} />
          </button>
        </div>

        <div className="event-modal-body">
          <label className="event-modal-field">
            <span>{t('page.titleLabel')}</span>
            <input
              autoFocus
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder={t('page.titlePlaceholder')}
              maxLength={500}
            />
          </label>

          <div className="event-modal-field">
            <span>{t('settings.icon')}</span>
            <button
              ref={iconBtnRef}
              type="button"
              className={`new-page-icon-btn${icon ? ' new-page-icon-btn--set' : ''}`}
              onClick={openPicker}
              title={icon ? t('page.changeIcon') : t('page.addIcon')}
              aria-label={icon ? t('page.changeIcon') : t('page.addIcon')}
            >
              {icon ? (
                <span className="new-page-icon-emoji">{icon}</span>
              ) : (
                <>
                  <PlusIcon size={14} />
                  <span>{t('page.addIcon')}</span>
                </>
              )}
            </button>
          </div>

          {error && <div className="event-modal-error" role="alert">{error}</div>}
        </div>

        <div className="event-modal-footer">
          <button type="button" className="event-modal-cancel" onClick={onClose} disabled={saving}>
            {t('common.cancel')}
          </button>
          <button type="button" className="event-modal-save" onClick={create} disabled={saving}>
            {saving ? <LoaderIcon size={14} /> : t('common.create')}
          </button>
        </div>

        <IconPicker
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          onSelect={setIcon}
          onRemove={() => setIcon('')}
          anchorRect={pickerAnchor}
          zIndex={2300}
        />
      </div>
    </div>,
    document.body
  );
}
