import { useEffect, useState } from 'react';
import { mediaUrl, posterUrl, type TripMedia } from '../lib/model';
import { shopDesignSchema } from '../lib/shop-design';
import { PostDesign } from './PostDesign';
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
  useCarousel,
  type CarouselOptions,
} from './ui/carousel';

function CarouselControls({ count }: { count: number }) {
  const { api } = useCarousel();
  const [current, setCurrent] = useState(1);
  useEffect(() => {
    if (!api) return;
    const update = () => {
      setCurrent(api.selectedScrollSnap() + 1);
    };
    update();
    api.on('select', update);
    api.on('reInit', update);
    return () => {
      api.off('select', update);
      api.off('reInit', update);
    };
  }, [api]);
  return count > 1 ? (
    <div className="flex items-center justify-between gap-3 px-4 py-3 min-[601px]:hidden">
      <span aria-live="polite" aria-atomic="true">
        {current} / {count}
      </span>
      <div className="flex gap-2">
        <CarouselPrevious />
        <CarouselNext />
      </div>
    </div>
  ) : null;
}

const carouselOptions: CarouselOptions = {
  align: 'start',
  containScroll: 'trimSnaps',
  breakpoints: { '(min-width: 601px)': { active: false } },
  watchDrag: (_api, event) =>
    !(event.target instanceof Element && event.target.closest('video')),
};

export function PostMedia({
  items,
  design: value,
  title,
}: {
  items: TripMedia[];
  design?: unknown;
  title: string;
}) {
  const parsed = shopDesignSchema.safeParse(value);
  const design = parsed.success ? parsed.data : undefined;
  const count = items.length + (design ? 1 : 0);
  if (!count) return null;
  return (
    <Carousel
      className="post-carousel min-w-0"
      aria-label={`${title} media`}
      opts={carouselOptions}
    >
      <CarouselContent className="post-media -ml-[5px] touch-pan-y items-stretch select-none min-[601px]:ml-0 min-[601px]:grid min-[601px]:grid-cols-2 min-[601px]:items-start min-[601px]:gap-[5px]">
        {items.map((item, index) => (
          <CarouselItem
            key={item.id}
            aria-label={`${String(index + 1)} of ${String(count)}`}
            className="basis-[88%] pl-[5px] min-[601px]:pl-0 min-[601px]:first:col-span-2"
          >
            {item.kind === 'video' ? (
              <div
                className="media-tile relative aspect-[1.15] min-w-0 overflow-hidden bg-muted"
                data-feedback-id={`media-${item.id}`}
              >
                <video
                  src={mediaUrl(item)}
                  poster={posterUrl(item)}
                  controls
                  playsInline
                  preload="metadata"
                  aria-label={item.title}
                  className="size-full object-cover"
                />
              </div>
            ) : (
              <a
                className="media-tile relative block aspect-[1.15] min-w-0 overflow-hidden bg-muted"
                href={`/media/${item.slug || item.id}`}
                aria-label={item.title}
                data-feedback-id={`media-${item.id}`}
                draggable={false}
              >
                <img
                  src={posterUrl(item)}
                  alt={item.title}
                  loading="lazy"
                  draggable={false}
                  className="size-full object-cover"
                />
              </a>
            )}
          </CarouselItem>
        ))}
        {design && (
          <CarouselItem
            aria-label={`${String(count)} of ${String(count)}, shop design`}
            className={`post-design-slide basis-[88%] pl-4 min-[601px]:col-span-2 min-[601px]:px-4 min-[601px]:pb-4 ${items.length ? 'min-[601px]:mt-[11px]' : 'min-[601px]:mt-4'}`}
          >
            <PostDesign design={design} />
          </CarouselItem>
        )}
      </CarouselContent>
      <CarouselControls count={count} />
    </Carousel>
  );
}
