import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Moments to Media',
    short_name: 'Moments',
    description: 'Event photo and video crews, clients and the studio, in one place.',
    start_url: '/',
    display: 'standalone',
    background_color: '#F7F4EF',
    theme_color: '#1F1F1F',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  };
}
