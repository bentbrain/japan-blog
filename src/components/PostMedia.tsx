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
      const selected = api.selectedScrollSnap();
      setCurrent(selected + 1);
      api.slideNodes().forEach((slide, index) => {
        slide.dataset.videoActive = String(index === selected);
      });
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
    <div className="flex items-center justify-between gap-3 px-4 py-3">
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
  watchDrag: (_api, event) =>
    !(event.target instanceof Element && event.target.closest('video')),
};

const galleryOptions: CarouselOptions = {
  ...carouselOptions,
  breakpoints: {
    '(prefers-reduced-motion: reduce)': { duration: 0 },
  },
  watchDrag: (_api, event) => {
    const video =
      event.target instanceof Element ? event.target.closest('video') : null;
    if (!(video instanceof HTMLVideoElement)) return true;
    if (document.fullscreenElement) return false;
    const point = 'touches' in event ? event.touches[0] : event;
    // Leave the native control bar's pointer gestures to the video player.
    return Boolean(
      point && point.clientY < video.getBoundingClientRect().bottom - 56,
    );
  },
};

export function PostMedia({
  items,
  design: value,
  title,
  layout = 'carousel',
}: {
  items: TripMedia[];
  design?: unknown;
  title: string;
  layout?: 'carousel' | 'responsive-gallery';
}) {
  const boundedGallery = layout === 'responsive-gallery';
  const parsed = shopDesignSchema.safeParse(value);
  const design = parsed.success ? parsed.data : undefined;
  const count = items.length + (design ? 1 : 0);
  if (!count) return null;
  return (
    <Carousel
      className={`post-carousel @container/media min-w-0 ${boundedGallery ? 'feed-gallery' : ''}`}
      aria-label={`${title} media`}
      opts={boundedGallery ? galleryOptions : carouselOptions}
    >
      <CarouselContent
        className={
          boundedGallery
            ? 'post-media ml-0 h-[min(320px,50svh)] touch-pan-y items-start select-none'
            : 'post-media -ml-[5px] touch-pan-y items-start select-none'
        }
      >
        {items.map((item, index) => (
          <CarouselItem
            key={item.id}
            aria-label={`${String(index + 1)} of ${String(count)}`}
            data-video-active={index === 0 ? 'true' : 'false'}
            className={
              boundedGallery
                ? 'h-full basis-full pl-0'
                : `pl-[5px] ${count > 1 ? 'basis-[88%] @min-[640px]/media:basis-[70%]' : 'basis-full'}`
            }
          >
            {item.kind === 'video' ? (
              <div
                className={`media-tile relative min-w-0 overflow-hidden bg-muted ${boundedGallery ? 'h-full' : ''}`}
                data-feedback-id={`media-${item.id}`}
              >
                <video
                  data-visibility-video
                  muted
                  loop
                  src={mediaUrl(item)}
                  poster={posterUrl(item)}
                  controls
                  playsInline
                  preload="metadata"
                  aria-label={item.title}
                  className={
                    boundedGallery
                      ? 'block size-full object-contain'
                      : 'block h-auto w-full'
                  }
                />
              </div>
            ) : (
              <a
                className={`media-tile relative block min-w-0 overflow-hidden bg-muted ${boundedGallery ? 'h-full' : ''}`}
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
                  className={
                    boundedGallery
                      ? 'block size-full object-contain'
                      : 'block h-auto w-full'
                  }
                />
              </a>
            )}
          </CarouselItem>
        ))}
        {design && (
          <CarouselItem
            aria-label={`${String(count)} of ${String(count)}, shop design`}
            className={
              boundedGallery
                ? 'post-design-slide h-full basis-full px-4 pb-4 [&_.post-design]:h-full [&_.post-design_img]:h-full'
                : `post-design-slide px-4 pb-4 ${count > 1 ? 'basis-[88%] @min-[640px]/media:basis-[70%]' : 'basis-full'}`
            }
          >
            <PostDesign design={design} />
          </CarouselItem>
        )}
      </CarouselContent>
      <CarouselControls count={count} />
    </Carousel>
  );
}
