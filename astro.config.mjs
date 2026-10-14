import cloudflare from '@astrojs/cloudflare';
import react from '@astrojs/react';
import { d1, r2 } from '@emdash-cms/cloudflare';
import { defineConfig } from 'astro/config';
import emdash from 'emdash/astro';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({
  site: 'https://jp.bent.build',
  output: 'server',
  vite: { plugins: [tailwindcss()] },
  adapter: cloudflare({
    imageService: 'passthrough',
    persistState: process.env.TEST_EPHEMERAL === '1' ? false : undefined,
  }),
  integrations: [
    react(),
    emdash({
      database: d1({ binding: 'DB', session: 'auto' }),
      storage: r2({ binding: 'MEDIA' }),
      toolbar: false,
      images: false,
      maxUploadSize: 64 * 1024 * 1024,
      plugins: [
        {
          id: 'japan-trip',
          version: '1.0.0',
          entrypoint: fileURLToPath(
            new URL('./src/plugins/trip-policy.ts', import.meta.url),
          ),
          adminEntry: fileURLToPath(
            new URL('./src/plugins/admin.tsx', import.meta.url),
          ),
          fieldWidgets: [
            { name: 'gallery', label: 'Trip media', fieldTypes: ['json'] },
          ],
        },
      ],
    }),
  ],
  devToolbar: { enabled: false },
});
