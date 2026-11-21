// Satu chip label untuk semua permukaan. Chip penuh warna: border + teks
// memakai warna label di atas latar netral; soft fill + centang hanya saat
// `selected` (dipakai picker). Label tanpa warna tetap netral.

import React from 'react';
import { LABEL_COLORS } from '../../server/shared/labels';
import type { Label } from '../types';
import { CheckIcon } from './Icons';

interface Props {
  label: Label;
  onClick?: () => void;
  selected?: boolean;
}

export function LabelChip({ label, onClick, selected = false }: Props) {
  const color =
    label.color && (LABEL_COLORS as readonly string[]).includes(label.color)
      ? label.color
      : null;
  const classes = [
    'label-chip',
    color ? `label-chip--${color}` : '',
    selected ? 'label-chip--selected' : '',
    onClick ? '' : 'label-chip--static',
  ].filter(Boolean).join(' ');
  return (
    <span className={classes} onClick={onClick} role={onClick ? 'button' : undefined}>
      {selected && <CheckIcon size={10} />}
      {label.name}
    </span>
  );
}
