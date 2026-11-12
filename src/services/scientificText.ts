const SUB_MAP: Record<string, string> = {
  '0': '₀',
  '1': '₁',
  '2': '₂',
  '3': '₃',
  '4': '₄',
  '5': '₅',
  '6': '₆',
  '7': '₇',
  '8': '₈',
  '9': '₉',
  '+': '₊',
  '-': '₋',
  '−': '₋',
  '=': '₌',
  '(': '₍',
  ')': '₎',
  a: 'ₐ',
  e: 'ₑ',
  h: 'ₕ',
  i: 'ᵢ',
  j: 'ⱼ',
  k: 'ₖ',
  l: 'ₗ',
  m: 'ₘ',
  n: 'ₙ',
  o: 'ₒ',
  p: 'ₚ',
  r: 'ᵣ',
  s: 'ₛ',
  t: 'ₜ',
  u: 'ᵤ',
  v: 'ᵥ',
  x: 'ₓ',
};

const SUP_MAP: Record<string, string> = {
  '0': '⁰',
  '1': '¹',
  '2': '²',
  '3': '³',
  '4': '⁴',
  '5': '⁵',
  '6': '⁶',
  '7': '⁷',
  '8': '⁸',
  '9': '⁹',
  '+': '⁺',
  '-': '⁻',
  '−': '⁻',
  '=': '⁼',
  '(': '⁽',
  ')': '⁾',
  i: 'ⁱ',
  n: 'ⁿ',
};

function mapChars(raw: string, table: Record<string, string>): string | null {
  const clean = raw.replace(/<[^>]+>/g, '').replace(/\s+/g, '').trim();
  if (!clean || clean.length > 16) return null;
  let out = '';
  for (const ch of clean) {
    const mapped = table[ch] || table[ch.toLowerCase()];
    if (!mapped) return null;
    out += mapped;
  }
  return out;
}

/**
 * Preserve chemical/physics sub/superscripts (e.g. CO2, Fe3+, Tc) cleanly
 * before stripping surrounding XML/HTML tags so tokens are never split into "CO 2".
 */
export function formatScientificTags(input: string): string {
  return String(input || '')
    .replace(/<(?:jats:)?sub\b[^>]*>([\s\S]*?)<\/(?:jats:)?sub>/gi, (_m, inner: string) => {
      const mapped = mapChars(inner, SUB_MAP);
      if (mapped) return mapped;
      const plain = inner.replace(/<[^>]+>/g, '').trim();
      return plain ? `_${plain}` : '';
    })
    .replace(/<(?:jats:)?sup\b[^>]*>([\s\S]*?)<\/(?:jats:)?sup>/gi, (_m, inner: string) => {
      const mapped = mapChars(inner, SUP_MAP);
      if (mapped) return mapped;
      const plain = inner.replace(/<[^>]+>/g, '').trim();
      return plain ? `^${plain}` : '';
    })
    .replace(/<(?:jats:)?(?:italic|i|bold|b|em|strong|scp)\b[^>]*>([\s\S]*?)<\/(?:jats:)?(?:italic|i|bold|b|em|strong|scp)>/gi, '$1');
}
