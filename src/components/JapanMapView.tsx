import { useEffect, useState } from 'react';
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from './ui/popover';
import { Button, buttonVariants } from './ui/button';
type MapItem = {
  id: string;
  slug: string | null;
  title: string;
  place: string;
  src: string;
};
type Group = { x: number; y: number; items: MapItem[] };
export function JapanMapView({
  land,
  groups,
}: {
  land: string;
  groups: Group[];
}) {
  const [active, setActive] = useState<number | null>(null);
  const [index, setIndex] = useState(0);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setReady(true);
    const selected = new URLSearchParams(location.search).get('media');
    if (!selected) return;
    const group = groups.findIndex((entry) =>
      entry.items.some((item) => item.id === selected),
    );
    if (group >= 0) {
      setActive(group);
      setIndex(
        groups[group]?.items.findIndex((item) => item.id === selected) ?? 0,
      );
    }
  }, [groups]);
  return (
    <div
      className="map-wrap relative h-[390px] overflow-hidden bg-white text-[#0647ff] [background-image:radial-gradient(#0647ff24_0.75px,transparent_0.75px)] [background-size:8px_8px] min-[601px]:h-[440px]"
      id="japan-map"
      data-feedback-id="japan-map"
    >
      <svg
        className="size-full"
        viewBox="0 0 760 440"
        aria-label="Japan media map"
        role="group"
      >
        <path
          className="fill-white stroke-[#0647ff] [stroke-width:0.8]"
          strokeLinejoin="round"
          d={land}
        />
        {groups.map((group, groupIndex) => {
          const selected = group.items[active === groupIndex ? index : 0];
          return (
            <Popover
              key={groupIndex}
              open={active === groupIndex}
              onOpenChange={(open, details) => {
                if (!open && details.reason === 'trigger-press') {
                  details.cancel();
                  return;
                }
                if (open) {
                  setActive(groupIndex);
                  setIndex(0);
                } else setActive(null);
              }}
            >
              <foreignObject
                x={group.x - 15}
                y={group.y - 15}
                width="30"
                height="30"
                overflow="visible"
              >
                <PopoverTrigger
                  disabled={!ready}
                  className="map-marker flex size-[30px] items-center justify-center rounded-full border-[1.5px] border-white bg-[#0647ff] p-0 text-[10px] text-white outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
                  aria-label={`${group.items[0]?.place || 'location'}, ${String(group.items.length)} items`}
                  onPointerEnter={(event) => {
                    if (event.pointerType === 'mouse') {
                      setActive(groupIndex);
                      setIndex(0);
                    }
                  }}
                >
                  {group.items.length}
                </PopoverTrigger>
              </foreignObject>
              <text
                className="fill-[#0647ff] font-mono text-[10px] min-[601px]:text-[11px]"
                x={group.x + 20}
                y={group.y + 4}
              >
                {group.items[0]?.place}
              </text>
              {selected && (
                <PopoverContent
                  className="map-detail data-open:animate-none data-closed:animate-none relative w-[160px] gap-2 rounded-none border border-[#0647ff] bg-white p-2 text-[#0647ff] shadow-none ring-0 min-[601px]:w-[190px]"
                  side="bottom"
                  align="end"
                  sideOffset={10}
                  data-feedback-id="map-preview"
                >
                  <Button
                    className="map-close absolute top-1 right-1 z-10 size-[26px] min-h-[26px] border-[#0647ff] bg-white p-0 text-[#0647ff] hover:bg-[#0647ff] hover:text-white dark:bg-white dark:border-[#0647ff] dark:hover:bg-[#0647ff]"
                    aria-label="Close map preview"
                    onClick={() => {
                      setActive(null);
                    }}
                  >
                    ×
                  </Button>
                  <img
                    src={selected.src}
                    alt={selected.title}
                    className="h-20 w-full object-cover min-[601px]:h-[110px]"
                  />
                  <PopoverTitle className="font-normal">
                    {selected.place} / {index + 1} of {group.items.length}
                  </PopoverTitle>
                  <div className="flex justify-between gap-3">
                    <Button
                      size="sm"
                      className="border-[#0647ff] bg-white text-[#0647ff] hover:bg-[#0647ff] hover:text-white"
                      aria-label="Previous photo at this location"
                      onClick={() => {
                        setIndex(
                          (current) =>
                            (current - 1 + group.items.length) %
                            group.items.length,
                        );
                      }}
                    >
                      ←
                    </Button>
                    <Button
                      size="sm"
                      className="border-[#0647ff] bg-white text-[#0647ff] hover:bg-[#0647ff] hover:text-white"
                      aria-label="Next photo at this location"
                      onClick={() => {
                        setIndex(
                          (current) => (current + 1) % group.items.length,
                        );
                      }}
                    >
                      →
                    </Button>
                  </div>
                  <a
                    className={buttonVariants({
                      variant: 'link',
                      className: 'h-auto justify-start p-0 text-[#0647ff]',
                    })}
                    href={`/media/${selected.slug || selected.id}`}
                  >
                    VIEW MEDIA →
                  </a>
                </PopoverContent>
              )}
            </Popover>
          );
        })}
      </svg>
      {!groups.length && (
        <span className="absolute bottom-3 left-3">no photos yet</span>
      )}
    </div>
  );
}
