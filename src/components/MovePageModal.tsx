// Move-page picker. Lists the private root and the page tree, excluding the
// page being moved (and therefore its own subtree) so a move can never create
// a cycle.

import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Page } from '../types';
import { buildPageTree, usePageContext } from '../contexts/PageContext';
import { useLanguage } from '../i18n/LanguageContext';
import { DocumentIcon, LoaderIcon, XIcon } from './Icons';

interface Props {
  page: Page | null;
  onClose: () => void;
}

export function MovePageModal({ page, onClose }: Props) {
  const { t } = useLanguage();
  const { pages, updatePage } = usePageContext();
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!page) return;
    setMoving(false);
    setError(null);
  }, [page]);

  useEffect(() => {
    if (!page) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !moving) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [page, moving, onClose]);

  const tree = useMemo(() => buildPageTree(pages), [pages]);

  if (!page) return null;

  const move = async (destinationId: string | null) => {
    if (moving) return;
    setMoving(true);
    setError(null);
    try {
      const siblings = pages.filter(
        p => (p.parent_id ?? null) === destinationId && p.id !== page.id
      );
      const position = siblings.reduce((max, p) => Math.max(max, p.position), 0) + 1000;
      await updatePage(page.id, { parent_id: destinationId, position });
      onClose();
    } catch (err) {
      console.error('Failed to move page', err);
      setError(t('page.moveError'));
    } finally {
      setMoving(false);
    }
  };

  const renderTree = (nodes: Page[], depth = 0): React.ReactNode =>
    nodes.map(node => {
      if (node.id === page.id) return null;
      return (
        <React.Fragment key={node.id}>
          <button
            type="button"
            className="move-page-option"
            style={{ paddingLeft: `calc(${depth} * var(--space-3) + var(--space-2))` }}
            onClick={() => move(node.id)}
            disabled={moving}
          >
            <span className="move-page-option-icon">
              {node.icon ? node.icon : node.is_project && !node.parent_id ? '📁' : <DocumentIcon size={14} />}
            </span>
            <span className="move-page-option-title">{node.title || t('sidebar.untitledPage')}</span>
            {node.is_project && !node.parent_id && (
              <span className="move-page-option-badge">{t('page.projectBadge')}</span>
            )}
          </button>
          {node.children && node.children.length > 0 && renderTree(node.children, depth + 1)}
        </React.Fragment>
      );
    });

  return createPortal(
    <div
      className="event-modal-backdrop"
      onMouseDown={(e) => { if (e.target === e.currentTarget && !moving) onClose(); }}
    >
      <div className="event-modal" role="dialog" aria-modal="true" aria-label={t('page.movePage')}>
        <div className="event-modal-header">
          <span className="event-modal-title">{t('page.movePage')}</span>
          <button type="button" className="event-modal-close" onClick={onClose} aria-label="Close">
            <XIcon size={15} />
          </button>
        </div>

        <div className="event-modal-body">
          <div className="move-page-hint">{t('page.moveHint')}</div>
          <div className="move-page-list">
            <button
              type="button"
              className="move-page-option move-page-option--root"
              onClick={() => move(null)}
              disabled={moving}
            >
              <span className="move-page-option-icon"><DocumentIcon size={14} /></span>
              <span className="move-page-option-title">{t('sidebar.private')}</span>
            </button>
            {renderTree(tree)}
          </div>
          {error && <div className="event-modal-error" role="alert">{error}</div>}
        </div>

        <div className="event-modal-footer">
          <button type="button" className="event-modal-cancel" onClick={onClose} disabled={moving}>
            {t('common.cancel')}
          </button>
          {moving && <span className="move-page-loading"><LoaderIcon size={14} /></span>}
        </div>
      </div>
    </div>,
    document.body
  );
}
