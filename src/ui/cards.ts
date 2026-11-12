import type { ArticleFilterMode, JournalArticle } from '../types';
import { articleSelectionKey } from './cardActions';
import { articleMatchesSearch, toggleTranslateAll as runBulkTranslate, updateBulkTranslateButton } from './cardTranslation';
import { type FeedHostContext, type FeedUIState, populateCollectionSelector } from './feedState';
import { refreshFilterPills, renderArticles, renderSkeletonCards } from './cardsRender';

export { loadFeed, retryJournalFeed } from './feedLoad';
export {
  populateCollectionSelector,
  refreshFilterPills,
  renderArticles,
  renderSkeletonCards,
  updateBulkTranslateButton,
};

export function toggleTranslateAll(doc: Document, ctx: FeedHostContext, state: FeedUIState): Promise<void> {
  return runBulkTranslate(doc, ctx, state, () => renderArticles(doc, ctx, state));
}

function articleMatchesFilter(article: JournalArticle, mode: ArticleFilterMode): boolean {
  switch (mode) {
    case 'oa':
      return Boolean(article.isOpenAccess);
    case 'abstract':
      return Boolean(article.abstract);
    case 'figures':
      return Boolean(article.figures?.length);
    case 'unread':
      return !article._read;
    case 'starred':
      return Boolean(article._starred);
    default:
      return true;
  }
}

export function toggleSelectAllVisible(doc: Document, ctx: FeedHostContext, state: FeedUIState): void {
  if (state.selectedKeys.size > 0) {
    state.selectedKeys.clear();
  } else {
    const targets = state.articles.filter(
      (a) => articleMatchesFilter(a, state.filterMode) && articleMatchesSearch(a, state.articleQuery)
    );
    for (const article of targets) {
      state.selectedKeys.add(articleSelectionKey(article));
    }
  }
  renderArticles(doc, ctx, state);
}
