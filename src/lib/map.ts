import { geoMercator, geoPath } from 'd3-geo';
import { z } from 'zod';
import japan from './japan.json';
import type { TripMedia } from './model';

const geometry = z
  .object({
    type: z.literal('MultiPolygon'),
    coordinates: z.array(z.array(z.array(z.array(z.number())))),
  })
  .parse(japan.geometry);

type Location = Pick<TripMedia, 'latitude' | 'longitude'>;

// A nearby buffer around Japan, including Okinawa, Ogasawara,
// Okinotorishima and Minamitorishima. This is a display region, not a border.
export function isJapanMapLocation({ latitude, longitude }: Location) {
  return (
    latitude >= 19 && latitude <= 47 && longitude >= 121 && longitude <= 155
  );
}

export function tripMap(media: Location[]) {
  const mapMedia = media.filter(isJapanMapLocation);
  const projection = geoMercator().fitExtent(
    [
      [105, 20],
      [650, 420],
    ],
    {
      type: 'GeometryCollection',
      geometries: [
        geometry,
        {
          type: 'MultiPoint',
          coordinates: mapMedia.map((item) => [item.longitude, item.latitude]),
        },
      ],
    },
  );
  return {
    projectMedia: (item: Location) =>
      isJapanMapLocation(item)
        ? projection([item.longitude, item.latitude])
        : null,
    land: geoPath(projection)(geometry) || '',
  };
}
