import type { TranslateProvider, UILanguage } from '../types';
import { httpGetJSON, httpPostForm, httpPostJSON } from './http';

declare const Zotero: any;

export interface OpenAITranslateConfig {
  endpoint?: string;
  apiKey?: string;
  model?: string;
}

export function detectLang(text: string | undefined | null): UILanguage {
  return /[\u4e00-\u9fff]/.test(text || '') ? 'zh' : 'en';
}

export function getTranslationTarget(text: string, uiLang: UILanguage): UILanguage {
  const src = detectLang(text);
  if (src !== uiLang) {
    return uiLang;
  }
  return src === 'zh' ? 'en' : 'zh';
}

export function chunkText(text: string, max: number): string[] {
  const parts: string[] = [];
  let s = text;
  while (s.length > max) {
    let cut = s.lastIndexOf('. ', max);
    if (cut < Math.floor(max / 3)) {
      cut = max - 1;
    }
    parts.push(s.slice(0, cut + 1));
    s = s.slice(cut + 1);
  }
  if (s) {
    parts.push(s);
  }
  return parts;
}

async function translateViaGoogle(
  text: string,
  target: UILanguage,
  src: UILanguage
): Promise<string> {
  const tl = target === 'zh' ? 'zh-CN' : 'en';
  const sl = src === 'zh' ? 'zh-CN' : 'en';
  const out: string[] = [];
  for (const chunk of chunkText(text, 1500)) {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sl}&tl=${tl}&dt=t`;
    const raw = await httpPostForm(url, `q=${encodeURIComponent(chunk)}`);
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data[0])) {
      throw new Error('Unexpected Google translation response');
    }
    out.push(
      data[0].map((seg: unknown) => (Array.isArray(seg) && seg[0] ? String(seg[0]) : '')).join('')
    );
  }
  return out.join(' ');
}

async function translateViaMyMemory(
  text: string,
  target: UILanguage,
  src: UILanguage
): Promise<string> {
  const tl = target === 'zh' ? 'zh-CN' : 'en';
  const sl = src === 'zh' ? 'zh-CN' : 'en';
  const out: string[] = [];
  for (const chunk of chunkText(text, 450)) {
    const url =
      `https://api.mymemory.translated.net/get?q=${encodeURIComponent(chunk)}` +
      `&langpair=${sl}|${tl}`;
    const data = await httpGetJSON<any>(url);
    if (!data?.responseData || data.responseData.translatedText == null) {
      throw new Error('Unexpected MyMemory translation response');
    }
    out.push(String(data.responseData.translatedText));
  }
  return out.join('');
}

async function translateViaOpenAI(
  text: string,
  target: UILanguage,
  cfg?: OpenAITranslateConfig
): Promise<string> {
  const endpoint = String(cfg?.endpoint || 'https://api.openai.com/v1/chat/completions').trim();
  const apiKey = String(cfg?.apiKey || '').trim();
  const model = String(cfg?.model || 'gpt-4o-mini').trim();
  if (!endpoint || !apiKey) {
    throw new Error('OpenAI-compatible endpoint or API key is not configured');
  }
  const targetName = target === 'zh' ? 'Simplified Chinese' : 'English';
  const data = await httpPostJSON<any>(
    endpoint,
    {
      model,
      temperature: 0.1,
      messages: [
        {
          role: 'system',
          content: `Translate the following scientific paper text into ${targetName}. Preserve chemical formulas, physical symbols, units, and LaTeX notation accurately. Return only the translation.`,
        },
        { role: 'user', content: text },
      ],
    },
    {
      headers: { Authorization: `Bearer ${apiKey}` },
      timeout: 25000,
    }
  );
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('Unexpected OpenAI translation response');
  }
  return content.trim();
}

async function translateViaPDFTranslate(
  text: string,
  target: UILanguage,
  src: UILanguage,
  zotArg?: any
): Promise<string> {
  const zot =
    zotArg?.PDFTranslate ? zotArg : typeof Zotero !== 'undefined' ? Zotero : (globalThis as any).Zotero;
  const api = zot?.PDFTranslate?.api;
  if (typeof api?.translate !== 'function') {
    throw new Error('Zotero PDF Translate (windingwind/zotero-pdf-translate) is not installed or active');
  }
  const langTo = target === 'zh' ? 'zh-CN' : 'en';
  const langFrom = src === 'zh' ? 'zh-CN' : 'en';
  const extract = (res: any): string => {
    const out = typeof res === 'string' ? res : res?.result ?? res?.text ?? '';
    return typeof out === 'string' ? out.trim() : '';
  };

  const translateChunk = async (chunk: string): Promise<string> => {
    let out = '';
    try {
      out = extract(await api.translate(chunk, { langFrom, langTo }));
    } catch (err) {
      out = extract(await api.translate(chunk));
      if (!out) throw err;
    }
    if (!out) {
      out = extract(await api.translate(chunk));
    }
    return out;
  };

  const parts = text.length > 1800 ? chunkText(text, 1600) : [text];
  const translatedParts: string[] = [];
  for (const part of parts) {
    const out = await translateChunk(part);
    if (!out) throw new Error('Empty response from Zotero PDF Translate');
    translatedParts.push(out);
  }
  const translated = translatedParts.join(' ').trim();
  if (!translated || translated === text.trim()) {
    throw new Error('Empty or unchanged response from Zotero PDF Translate');
  }
  if (src !== target && detectLang(translated) !== target) {
    throw new Error(`Zotero PDF Translate target language mismatch (expected ${target})`);
  }
  return translated;
}

export async function translateText(
  text: string,
  target: UILanguage,
  provider: TranslateProvider = 'pdftranslate',
  onDebug?: (msg: string) => void,
  llmConfig?: OpenAITranslateConfig,
  zotArg?: any
): Promise<string> {
  if (!text || !text.trim()) {
    return text;
  }
  const src = detectLang(text);
  if (src === target) {
    return text;
  }
  const order: TranslateProvider[] =
    provider === 'openai'
      ? ['openai', 'pdftranslate', 'google', 'mymemory']
      : provider === 'mymemory'
        ? ['mymemory', 'google']
        : provider === 'google'
          ? ['google', 'mymemory']
          : ['pdftranslate', 'google', 'mymemory'];
  let lastError: unknown;
  for (const p of order) {
    try {
      if (p === 'pdftranslate') {
        return await translateViaPDFTranslate(text, target, src, zotArg);
      }
      if (p === 'openai') {
        return await translateViaOpenAI(text, target, llmConfig);
      }
      if (p === 'google') {
        return await translateViaGoogle(text, target, src);
      }
      return await translateViaMyMemory(text, target, src);
    } catch (error) {
      lastError = error;
      onDebug?.(`JournalFlow: translate via ${p} failed: ${error}`);
    }
  }
  throw lastError instanceof Error ? lastError : new Error('translation failed');
}
