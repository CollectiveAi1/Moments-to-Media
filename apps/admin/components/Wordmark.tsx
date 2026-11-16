import Image from 'next/image';
import wordmark from '../../../assets/brand/m2m-wordmark.png';

/** UI-SPEC section 2: the wordmark is 176px wide on the sidebar and sign-in. */
export function Wordmark() {
  return (
    <Image
      src={wordmark}
      alt="Moments to Media Content Co."
      priority
      style={{ width: 176, height: 'auto', display: 'block' }}
    />
  );
}
