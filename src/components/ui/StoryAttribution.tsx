import type { NewsItem } from '@/lib/core/types';
import { formatTimeAgo } from '@/components/map/MapConstants';
import { safeExternalHttpUrl } from '@/lib/security/externalUrl';
import styles from './StoryAttribution.module.css';

export default function StoryAttribution({ item }: { item: NewsItem }) {
  const headlineUrl = safeExternalHttpUrl(item.url);
  const description = item.description ? item.descriptionProvenance : null;
  const descriptionUrl = safeExternalHttpUrl(description?.url);

  return (
    <div className={styles.attribution} onClick={(event) => event.stopPropagation()}>
      <span className={styles.citation} title={`Headline: ${item.source}${item.headlinePublishedAt ? ` · ${formatTimeAgo(item.headlinePublishedAt)}` : ''}`}>
        Headline: {headlineUrl
          ? <a href={headlineUrl.href} target="_blank" rel="noopener noreferrer">{item.source}</a>
          : item.source}
      </span>
      {item.description && (
        <span className={styles.citation} title={description ? `Description: ${description.name} · ${formatTimeAgo(description.published_at)}` : 'Description attribution unavailable for this older story.'}>
          Description: {description
            ? descriptionUrl
              ? <a href={descriptionUrl.href} target="_blank" rel="noopener noreferrer">{description.name}</a>
              : description.name
            : 'Unavailable'}
        </span>
      )}
      {item.independentPublisherCount != null && (
        <span className={styles.count}>
          {item.independentPublisherCount} independent {item.independentPublisherCount === 1 ? 'source' : 'sources'}
        </span>
      )}
    </div>
  );
}
