import type { ArticleFigure, FigureLabelInfo } from '../types';

export function cleanText(text: string | null | undefined): string {
  return (text || '').replace(/\s+/g, ' ').trim();
}

export function escapeRegExp(text: string): string {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function normalizeFigureText(text: string | null | undefined): string {
  return cleanText(text)
    .toLowerCase()
    .replace(/[.:;,\-\u2013\u2014_()[\]{}'"\u201c\u201d\u2018\u2019]/g, '')
    .replace(/\s+/g, ' ');
}

export function isPreviewFigure(text: string | null | undefined): boolean {
  return /(graphical\s+abstract|visual\s+abstract|table\s+of\s+contents|toc\s+graphic|cover\s+image|social\s+preview|preview\s+image|thumbnail|teaser|scheme\s+preview)/i.test(
    text || ''
  );
}

export function parseFigureLabelInfo(text: string | null | undefined): FigureLabelInfo | null {
  const value = cleanText(text);
  if (!value) return null;

  const extended = value.match(/\bextended\s+(?:data\s+)?fig(?:ure)?\.?\s*([s]?\d+)([a-z]?)\b/i);
  if (extended) {
    const number = parseInt(extended[1].replace(/^s/i, ''), 10);
    if (!number) return null;
    const suffix = (extended[2] || '').toLowerCase();
    return {
      kind: 'extended',
      group: 1,
      number,
      suffix,
      key: `extended:${number}:${suffix}`,
      label: `Extended Fig. ${number}${suffix}`,
    };
  }

  const chemOrPlate = value.match(/\b(scheme|chart|plate)\s*([s]?\d+)([a-z]?)\b/i);
  if (chemOrPlate) {
    const kindWord =
      chemOrPlate[1].charAt(0).toUpperCase() + chemOrPlate[1].slice(1).toLowerCase();
    const isSuppl =
      /^s/i.test(chemOrPlate[2]) || /\b(?:supplementary|supplemental|suppl\.?)\b/i.test(value);
    const number = parseInt(chemOrPlate[2].replace(/^s/i, ''), 10);
    if (!number) return null;
    const suffix = (chemOrPlate[3] || '').toLowerCase();
    const displayNum = `${isSuppl ? 'S' : ''}${number}${suffix}`;
    return {
      kind: isSuppl ? 'supplementary' : 'main',
      group: isSuppl ? 2 : 0,
      number,
      suffix,
      key: `${kindWord.toLowerCase()}:${isSuppl ? 's' : ''}${number}:${suffix}`,
      label: `${kindWord} ${displayNum}`,
    };
  }

  const cjk = value.match(/(附图|图)\s*[sS]?(\d+)([a-zA-Z]?)/);
  if (cjk) {
    const isSuppl = cjk[1] === '附图' || /[sS]\d+/.test(cjk[0]);
    const number = parseInt(cjk[2], 10);
    if (!number) return null;
    const suffix = (cjk[3] || '').toLowerCase();
    return {
      kind: isSuppl ? 'supplementary' : 'main',
      group: isSuppl ? 2 : 0,
      number,
      suffix,
      key: `${isSuppl ? 'supplementary' : 'main'}:${number}:${suffix}`,
      label: `Fig. ${isSuppl ? 'S' : ''}${number}${suffix}`,
    };
  }

  let normal = value.match(/\bfig(?:ure)?\.?\s*([s]?\d+)([a-z]?)\b/i);
  if (!normal && value.length <= 12) {
    normal = value.match(/^\s*([s]?\d+)([a-z]?)(?:\s*[:.\-\u2013\u2014]|\s*$)/i);
  }
  if (!normal) return null;

  const supplemental =
    /^s/i.test(normal[1]) ||
    /\b(?:supplementary|supplemental|suppl\.?)\s+fig(?:ure)?/i.test(value);
  const number = parseInt(normal[1].replace(/^s/i, ''), 10);
  if (!number) return null;
  const suffix = (normal[2] || '').toLowerCase();
  const labelNumber = `${supplemental ? 'S' : ''}${number}${suffix}`;
  return {
    kind: supplemental ? 'supplementary' : 'main',
    group: supplemental ? 2 : 0,
    number,
    suffix,
    key: `${supplemental ? 'supplementary' : 'main'}:${number}:${suffix}`,
    label: `Fig. ${labelNumber}`,
  };
}

export function splitFigureLabel(text: string): { info: FigureLabelInfo | null; caption: string } {
  const value = cleanText(text);
  const info = parseFigureLabelInfo(value);
  const match = value.match(
    /^((?:extended\s+(?:data\s+)?)?(?:fig(?:ure)?|scheme|chart|plate)\.?\s*[s]?\d+[a-z]?|(?:附图|图)\s*[sS]?\d+[a-zA-Z]?|[s]?\d+[a-z]?)(?:\s*[:.\-\u2013\u2014：]\s*|\s+)(.+)$/i
  );
  if (match && match[2] && match[2].length > 10) {
    return { info: parseFigureLabelInfo(match[1]) || info, caption: cleanText(match[2]) };
  }
  return { info, caption: '' };
}

export function stripCaptionLabel(label: string, caption: string): string {
  const l = cleanText(label);
  const c = cleanText(caption);
  if (!l || !c) return c;
  if (normalizeFigureText(l) === normalizeFigureText(c)) return '';
  const escaped = escapeRegExp(l).replace(/\\\./g, '\\.?');
  const re = new RegExp(`^\\s*${escaped}\\s*[:.\\-\\u2013\\u2014]?\\s*`, 'i');
  return cleanText(c.replace(re, ''));
}

export function stripKnownFigureLabel(info: FigureLabelInfo | null | undefined, caption: string): string {
  let text = cleanText(caption);
  if (!info || !text) return text;
  const number = `${info.number}${info.suffix || ''}`;
  const variants =
    info.kind === 'extended'
      ? [
          info.label,
          `Extended Data Fig. ${number}`,
          `Extended Data Figure ${number}`,
          `Extended Figure ${number}`,
        ]
      : [info.label, `Figure ${info.kind === 'supplementary' ? 'S' : ''}${number}`];
  for (const label of variants) {
    text = stripCaptionLabel(label, text);
  }
  return text;
}

export function figureSortValue(figure: ArticleFigure): [number, number, string] {
  const info = figure.labelInfo || parseFigureLabelInfo(figure.label);
  if (!info) return [9, 9999, ''];
  return [info.group, info.number, info.suffix || ''];
}

export function sortFigures(figures: ArticleFigure[]): ArticleFigure[] {
  return (figures || []).slice().sort((a, b) => {
    const av = figureSortValue(a);
    const bv = figureSortValue(b);
    if (av[0] !== bv[0]) return av[0] - bv[0];
    if (av[1] !== bv[1]) return av[1] - bv[1];
    return av[2].localeCompare(bv[2]);
  });
}
