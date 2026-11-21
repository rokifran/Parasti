// Palet warna preset untuk label. Tokens only: tiap swatch memetakan satu
// token --label-*; null = default (tanpa warna).

import React from 'react';
import { LABEL_COLORS } from '../../server/shared/labels';
import { useLanguage } from '../i18n/LanguageContext';

const COLOR_NAME_KEYS: Record<string, string> = {
  terracotta: 'labels.colorTerracotta',
  biru: 'labels.colorBiru',
  olive: 'labels.colorOlive',
  plum: 'labels.colorPlum',
  teal: 'labels.colorTeal',
  cokelat: 'labels.colorCokelat',
};

interface Props {
  value: string | null;
  onChange: (color: string | null) => void;
}

export function LabelColorPalette({ value, onChange }: Props) {
  const { t } = useLanguage();
  return (
    <div className="label-palette" role="group" aria-label={t('labels.color')}>
      <span className="label-palette-title">{t('labels.color')}</span>
      <button
        type="button"
        className="label-swatch label-swatch--default"
        aria-pressed={value === null}
        title={t('labels.colorDefault')}
        aria-label={t('labels.colorDefault')}
        onClick={() => onChange(null)}
      />
      {LABEL_COLORS.map(color => (
        <button
          key={color}
          type="button"
          className={`label-swatch label-swatch--${color}`}
          aria-pressed={value === color}
          title={t(COLOR_NAME_KEYS[color])}
          aria-label={t(COLOR_NAME_KEYS[color])}
          onClick={() => onChange(color)}
        />
      ))}
    </div>
  );
}
