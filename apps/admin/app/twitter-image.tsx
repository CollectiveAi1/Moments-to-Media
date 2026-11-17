import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';

export const alt = 'Moments to Media: event photo and video, from booking to delivery';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/** The picture shown when a link to the site is shared. */
export default async function OpenGraphImage() {
  const png = await readFile(join(process.cwd(), 'lib/brand/monogram.png'));
  const src = `data:image/png;base64,${png.toString('base64')}`;
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', background: '#F7F4EF', display: 'flex', alignItems: 'center', padding: '0 90px', gap: 60 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} width={300} height={304} alt="" />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div style={{ fontSize: 72, color: '#1F1F1F', letterSpacing: 2 }}>MOMENTS TO MEDIA</div>
          <div style={{ fontSize: 36, color: '#3F3B35' }}>Event photo and video, from booking to delivery.</div>
          <div style={{ fontSize: 28, color: '#70664F' }}>Check availability · Client portal · Crew</div>
        </div>
      </div>
    ),
    size,
  );
}
