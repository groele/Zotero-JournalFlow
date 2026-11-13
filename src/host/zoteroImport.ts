import { normalizeDOI } from '../services/openalex';
import type { JournalArticle, ZoteroCollectionSummary } from '../types';

declare const Zotero: any;

const ROOT_JOURNAL_COLLECTION_NAME = 'Zotero-JournalFlow';
const pendingCollectionCreations = new Map<string, Promise<{ collectionID: number | null; created: boolean }>>();

function normalizeCollectionName(name: string | null | undefined): string {
  return String(name || '').replace(/\s+/g, ' ').trim();
}

function collectionKey(name: string | null | undefined): string {
  return normalizeCollectionName(name).toLocaleLowerCase();
}

function findMatchingCollection(libraryID: number, targetKey: string, parentID: number | null): any | null {
  if (typeof Zotero === 'undefined' || !Zotero?.Collections) return null;
  if (parentID) {
    const direct =
      typeof Zotero.Collections.getByParent === 'function'
        ? Zotero.Collections.getByParent(parentID)
        : (Zotero.Collections.getByLibrary?.(libraryID, true) || []).filter(
            (c: any) => Number(c?.parentID || 0) === parentID
          );
    return (direct || []).find((c: any) => !c?.deleted && collectionKey(c?.name) === targetKey) || null;
  }
  const topLevel = Zotero.Collections.getByLibrary?.(libraryID, false) || [];
  return (
    topLevel.find(
      (c: any) => !c?.deleted && !c?.parentID && !c?.parentKey && collectionKey(c?.name) === targetKey
    ) || null
  );
}

async function ensureNamedCollection(
  libraryID: number,
  name: string,
  parentID: number | null
): Promise<{ collectionID: number | null; created: boolean }> {
  const cleanName = normalizeCollectionName(name);
  if (!cleanName || typeof Zotero === 'undefined' || !Zotero?.Collections?.getByLibrary) {
    return { collectionID: parentID, created: false };
  }

  const targetKey = collectionKey(cleanName);
  const existing = findMatchingCollection(libraryID, targetKey, parentID);
  if (existing?.id) {
    return { collectionID: Number(existing.id), created: false };
  }

  if (typeof Zotero.Collection !== 'function') {
    return { collectionID: parentID, created: false };
  }

  const lockKey = `${libraryID}:${parentID || 0}:${targetKey}`;
  const inFlight = pendingCollectionCreations.get(lockKey);
  if (inFlight) {
    return inFlight;
  }

  const task = (async (): Promise<{ collectionID: number | null; created: boolean }> => {
    try {
      const retryExisting = findMatchingCollection(libraryID, targetKey, parentID);
      if (retryExisting?.id) {
        return { collectionID: Number(retryExisting.id), created: false };
      }
      const col = new Zotero.Collection();
      col.libraryID = libraryID;
      col.name = cleanName;
      if (parentID) {
        col.parentID = parentID;
      }
      await col.saveTx();
      const createdId = Number(col.id || 0) || null;
      return createdId ? { collectionID: createdId, created: true } : { collectionID: parentID, created: false };
    } catch (error) {
      Zotero?.debug?.(`JournalFlow: failed to create collection "${cleanName}": ${error}`);
      return { collectionID: parentID, created: false };
    } finally {
      pendingCollectionCreations.delete(lockKey);
    }
  })();

  pendingCollectionCreations.set(lockKey, task);
  return task;
}

export async function ensureJournalCollection(
  journalName: string | null | undefined,
  parentCollectionID?: number | null
): Promise<{ collectionID: number | null; created: boolean }> {
  const explicitParentID = parentCollectionID ? Number(parentCollectionID) : null;
  if (typeof Zotero === 'undefined' || !Zotero?.Collections?.getByLibrary) {
    return { collectionID: explicitParentID, created: false };
  }

  const libraryID = Number(Zotero.Libraries?.userLibraryID || 1);
  const cleanJournal = normalizeCollectionName(journalName);

  if (explicitParentID) {
    if (!cleanJournal) {
      return { collectionID: explicitParentID, created: false };
    }
    const parentCol = Zotero.Collections.get?.(explicitParentID);
    if (parentCol && !parentCol.deleted && collectionKey(parentCol.name) === collectionKey(cleanJournal)) {
      return { collectionID: explicitParentID, created: false };
    }
    return ensureNamedCollection(libraryID, cleanJournal, explicitParentID);
  }

  const rootRes = await ensureNamedCollection(libraryID, ROOT_JOURNAL_COLLECTION_NAME, null);
  const rootID = rootRes.collectionID;
  if (!cleanJournal || !rootID) {
    return rootRes;
  }

  const childRes = await ensureNamedCollection(libraryID, cleanJournal, rootID);
  return { collectionID: childRes.collectionID, created: rootRes.created || childRes.created };
}

function parseCreator(name: string): { firstName?: string; lastName: string; creatorType: 'author'; fieldMode?: number } {
  const clean = name.trim();
  const idx = clean.lastIndexOf(' ');
  if (idx <= 0 || /\bet al\.?$/i.test(clean)) {
    return { lastName: clean, creatorType: 'author', fieldMode: 1 };
  }
  return {
    firstName: clean.slice(0, idx).trim(),
    lastName: clean.slice(idx + 1).trim(),
    creatorType: 'author',
  };
}

export async function addToZoteroByDOI(doi: string, collectionID?: number | null): Promise<unknown[]> {
  if (!doi) {
    throw new Error('Missing DOI');
  }
  const translate = new Zotero.Translate.Search();
  translate.setIdentifier({ DOI: doi });
  const translators = await translate.getTranslators();
  if (!translators || !translators.length) {
    throw new Error(`No translator found for DOI ${doi}`);
  }
  translate.setTranslator(translators);
  const items = await translate.translate({
    libraryID: Zotero.Libraries.userLibraryID,
    saveAttachments: true,
    ...(collectionID ? { collections: [collectionID] } : {}),
  });
  const list = Array.isArray(items) ? items : [];
  if (collectionID && list.length) {
    for (const item of list) {
      try {
        if (item?.parentItemID) continue;
        item.addToCollection?.(collectionID);
        await item.saveTx?.();
      } catch {}
    }
  }
  return list;
}

export async function importArticleToZotero(
  article: JournalArticle,
  options: { collectionID?: number | null } = {}
): Promise<{ itemID: number | null; usedFallback: boolean }> {
  const { collectionID } = await ensureJournalCollection(article.journal, options.collectionID || null);
  if (article.doi) {
    try {
      const items = await addToZoteroByDOI(article.doi, collectionID);
      if (items.length) {
        const first: any = items[0];
        return { itemID: Number(first?.id || 0) || null, usedFallback: false };
      }
    } catch (error) {
      Zotero?.debug?.(`JournalFlow: DOI translator fallback triggered for ${article.doi}: ${error}`);
    }
  }

  if (typeof Zotero === 'undefined' || !Zotero?.Item) {
    throw new Error('Zotero Item API unavailable');
  }

  const item = new Zotero.Item('journalArticle');
  item.libraryID = Zotero.Libraries?.userLibraryID || 1;
  item.setField('title', article.title || article.doi || 'Untitled');
  if (article.journal) item.setField('publicationTitle', article.journal);
  if (article.issn) item.setField('ISSN', article.issn);
  if (article.date) item.setField('date', article.date);
  if (article.volume) item.setField('volume', article.volume);
  if (article.issue) item.setField('issue', article.issue);
  if (article.pages) item.setField('pages', article.pages);
  if (article.doi) item.setField('DOI', article.doi);
  if (article.url) item.setField('url', article.url);
  if (article.abstract) item.setField('abstractNote', article.abstract);

  const rawAuthors = String(article.authors || '')
    .replace(/\s+et al\.?$/i, '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (rawAuthors.length) {
    item.setCreators(rawAuthors.map(parseCreator));
  }
  if (collectionID) {
    item.addToCollection(collectionID);
  }
  await item.saveTx();
  return { itemID: Number(item.id || 0) || null, usedFallback: true };
}

export async function getExistingLibraryDOIs(dois: string[]): Promise<Record<string, number>> {
  const result: Record<string, number> = {};
  const normalized = Array.from(new Set(dois.map((d) => normalizeDOI(d)).filter(Boolean)));
  if (!normalized.length || typeof Zotero === 'undefined' || !Zotero?.DB?.queryAsync) {
    return result;
  }
  try {
    const fieldID = Zotero.ItemFields?.getID?.('DOI');
    const libraryID = Zotero.Libraries?.userLibraryID || 1;
    if (!fieldID) return result;
    const wanted = new Set(normalized);
    for (let i = 0; i < normalized.length; i += 80) {
      const chunk = normalized.slice(i, i + 80);
      const variants = chunk.flatMap((d) => [
        d,
        `https://doi.org/${d}`,
        `http://doi.org/${d}`,
        `https://dx.doi.org/${d}`,
      ]);
      const placeholders = variants.map(() => '?').join(', ');
      const rows: Array<{ itemID: number; value: string }> = await Zotero.DB.queryAsync(
        `SELECT id.itemID, idv.value
         FROM itemData id
         JOIN itemDataValues idv ON id.valueID = idv.valueID
         JOIN items i ON i.itemID = id.itemID
         LEFT JOIN deletedItems di ON di.itemID = id.itemID
         WHERE id.fieldID = ? AND i.libraryID = ? AND di.itemID IS NULL AND LOWER(idv.value) IN (${placeholders})`,
        [fieldID, libraryID, ...variants]
      );
      for (const row of rows || []) {
        const key = normalizeDOI(row.value);
        if (key && wanted.has(key) && !result[key]) {
          result[key] = Number(row.itemID);
        }
      }
    }
  } catch (error) {
    Zotero?.debug?.(`JournalFlow: library DOI lookup skipped: ${error}`);
  }
  return result;
}

export function getUserCollections(): { collections: ZoteroCollectionSummary[]; activeCollectionID: number | null } {
  try {
    if (typeof Zotero === 'undefined' || !Zotero?.Collections?.getByLibrary) {
      return { collections: [], activeCollectionID: null };
    }
    const libID = Zotero.Libraries?.userLibraryID || 1;
    const all = (Zotero.Collections.getByLibrary(libID, true) || []).filter((c: any) => !c.deleted);
    const byId = new Map<number, any>(all.map((c: any) => [c.id, c]));
    const depthOf = (c: any) => {
      let depth = 0;
      let cur = c;
      while (cur?.parentID && depth < 5) {
        cur = byId.get(cur.parentID);
        depth++;
      }
      return depth;
    };
    const collections: ZoteroCollectionSummary[] = all.map((c: any) => ({
      id: Number(c.id),
      name: `${'  '.repeat(depthOf(c))}${String(c.name || '')}`,
    }));
    const pane = Zotero.getActiveZoteroPane?.() || Zotero.getMainWindow?.()?.ZoteroPane;
    const activeCollectionID = Number(pane?.getSelectedCollection?.()?.id || 0) || null;
    return { collections, activeCollectionID };
  } catch {
    return { collections: [], activeCollectionID: null };
  }
}

export function selectLibraryItem(itemID: number): void {
  if (!itemID || typeof Zotero === 'undefined') return;
  try {
    const mainWin = Zotero.getMainWindow?.();
    const tabs = mainWin?.Zotero_Tabs;
    const libTab = tabs?._tabs?.find?.((t: any) => t?.type === 'library' || t?.id === 'zotero-pane');
    if (libTab) tabs.select(libTab.id);
    const pane = mainWin?.ZoteroPane || Zotero.getActiveZoteroPane?.();
    pane?.selectItem?.(itemID);
    mainWin?.focus?.();
  } catch {}
}

export function openExternalURL(url: string): void {
  if (!url) return;
  if (typeof Zotero !== 'undefined' && Zotero?.launchURL) {
    Zotero.launchURL(url);
  }
}

export function openPreferencesPane(win?: any): void {
  try {
    const targetWin = win || Zotero?.getMainWindow?.();
    if (Zotero?.Utilities?.Internal?.openPreferences) {
      Zotero.Utilities.Internal.openPreferences('journalflow-preferences-pane');
    } else if (targetWin?.openPreferences) {
      targetWin.openPreferences('journalflow-preferences-pane');
    }
  } catch {}
}
