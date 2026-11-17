import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

/** The home-screen icon: the MM monogram on the brand background (iOS shows transparency as black). */
export default async function AppleIcon() {
  const png = await readFile(join(process.cwd(), 'lib/brand/monogram.png'));
  const src = `data:image/png;base64,${png.toString('base64')}`;
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', background: '#F7F4EF', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} width={140} height={142} alt="" />
      </div>
    ),
    size,
  );
}
