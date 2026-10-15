import { useEffect, useState } from 'react';
import { api } from '../lib/api-client';
import {
  categoryCollectionSchema,
  type CategoryCollection,
} from '../lib/category-collection-model';
import { CreateCategory } from './CreateCategory';
import { CategoryIconProviderStatus } from './CategoryIconProviderStatus';
import { CategoryIconStatus } from './CategoryIconStatus';

export function OwnerCategories() {
  const [collection, setCollection] = useState<CategoryCollection>({
    categories: [],
    icons: [],
  });
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const result = categoryCollectionSchema.parse(
          await api('/api/trip/categories'),
        );
        if (active) {
          setCollection(result);
          setError('');
          setLoaded(true);
        }
      } catch {
        if (active) setError('could not load categories');
      }
    };
    void load();
    const refresh = () => {
      void load();
    };
    const timer = setInterval(refresh, 15000);
    window.addEventListener('category-icons:changed', refresh);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener('category-icons:changed', refresh);
    };
  }, []);
  return (
    <div className="space-y-8" data-feedback-id="owner-categories">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1>categories</h1>
        <CreateCategory
          onCreated={(result) => {
            setCollection(result);
            setLoaded(true);
          }}
        />
      </div>
      <p role="status" className="empty:hidden">
        {error || (!loaded ? 'loading categories' : '')}
      </p>
      <CategoryIconProviderStatus />
      <section aria-label="Saved categories" className="border-t pt-4">
        <CategoryIconStatus
          names={collection.categories.map((category) => category.label)}
        />
      </section>
      <section
        aria-labelledby="icon-library-heading"
        className="space-y-4 border-t pt-4"
      >
        <h2 id="icon-library-heading">icon library</h2>
        {loaded && !collection.icons.length && (
          <p className="text-xs">generated icons will appear here.</p>
        )}
        <div className="grid grid-cols-2 gap-3 min-[601px]:grid-cols-4 min-[901px]:grid-cols-6">
          {collection.icons.map((icon) => (
            <figure
              key={icon.id}
              className="flex min-w-0 flex-col items-center gap-3 border p-4"
            >
              <span
                aria-hidden="true"
                className="size-8 bg-current [mask-image:var(--icon)] [mask-size:contain] [mask-repeat:no-repeat]"
                style={{ maskImage: `url("${icon.url}")` }}
              />
              <figcaption className="max-w-full text-center text-xs wrap-anywhere">
                {icon.label}
              </figcaption>
            </figure>
          ))}
        </div>
      </section>
    </div>
  );
}
