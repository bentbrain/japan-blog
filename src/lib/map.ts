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

// Mercator cannot display the poles. Limit only their display position;
// keep the original GPS on the media record.
const displayLatitude = (latitude: number) =>
  Math.max(-85, Math.min(85, latitude));

export function tripMap(media: Location[]) {
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
          coordinates: media.map((item) => [
            item.longitude,
            displayLatitude(item.latitude),
          ]),
        },
      ],
    },
  );
  return {
    projectMedia: (item: Location) =>
      projection([item.longitude, displayLatitude(item.latitude)]),
    land: geoPath(projection)(geometry) || '',
  };
}
