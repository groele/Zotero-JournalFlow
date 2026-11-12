import enFTL from '../locale/en-US/journalflow.ftl';
import zhFTL from '../locale/zh-CN/journalflow.ftl';
import { parseFluentFeedMessages } from './i18n/fluent';
import type { UILanguage } from './types';

export const ADDON_ID = 'journalflow@groele.org';
export const ADDON_VERSION = '2.0.9';
export const CHROME_ROOT = 'chrome://journalflow/content/';
export const PREF_BRANCH = 'extensions.journalflow.';
export const LEGACY_PREF_BRANCH = 'extensions.journallens.';

export const CACHE_SCHEMA = 'figures-v8-multi-publisher';
export const DAILY_FEED_CACHE_SCHEMA = 'daily-feed-v2';
export const CACHE_FILE_NAME = 'journalflow-cache.json';
export const DAILY_FEED_CACHE_MAX_BYTES = 8 * 1024 * 1024;

export const HOMEPAGE_URL = 'https://github.com/groele/Zotero-JournalFlow';
export const UPSTREAM_URL = 'https://github.com/Lyz-623/JournalLens';
export const POLITE_MAILTO = 'journalflow@groele.org';

export const DEFAULT_JOURNALS_JSON = JSON.stringify([
  { issn: '0028-0836', title: 'Nature', publisher: 'Springer Nature', altIssns: ['0028-0836', '1476-4687'] },
  { issn: '0036-8075', title: 'Science', publisher: 'AAAS', altIssns: ['0036-8075', '1095-9203'] },
  { issn: '0092-8674', title: 'Cell', publisher: 'Elsevier', altIssns: ['0092-8674', '1097-4172'] },
]);

export const PREF_DEFAULTS: Record<string, string | number | boolean> = {
  journals: DEFAULT_JOURNALS_JSON,
  windowMode: 'tab',
  uiLanguage: 'auto',
  daysToFetch: 14,
  articlesPerJournal: 200,
  filterArticleTypes: true,
  cacheTTLHours: 12,
  loadFigures: true,
  translateProvider: 'pdftranslate',
  llmEndpoint: 'https://api.openai.com/v1/chat/completions',
  llmApiKey: '',
  llmModel: 'gpt-4o-mini',
};

export const PUBTYPE_BLOCK: readonly string[] = [
  'news',
  'editorial',
  'comment',
  'correction',
  'erratum',
  'corrigendum',
  'retraction',
  'expression of concern',
  'obituary',
  'biography',
  'book review',
  'product review',
  'meeting report',
  'congress',
  'perspective',
  'historical article',
  'interview',
  'newspaper article',
  'published erratum',
  'patient education handout',
  'address',
  'paratext',
  'peer-review',
];

export const TITLE_BLOCK_RE =
  /^(editorial(?:\s+board)?|correction|author correction|publisher correction|erratum|corrigendum|retraction(?:\s+note)?|expression of concern|news\s*(?:&|and)\s*views|news\s+feature|in this issue|research highlights?|from the editors?|this month in|news in brief|books?\s*(?:in brief|received)|(?:inside\s+(?:front\s+|back\s+)?|front\s+|back\s+)cover(?:\s+(?:picture|image|profile))?|frontispiece|table\s+of\s+contents|issue\s+information|graphical\s+abstract|masthead|spotlights?|list\s+of\s+(?:referees|reviewers)|acknowledgements?\s+to\s+reviewers?|meet\s+the\s+authors?)\b/i;

export const UI_STRINGS: Record<UILanguage, Record<string, string>> = {
  en: parseFluentFeedMessages(enFTL),
  zh: parseFluentFeedMessages(zhFTL),
};
