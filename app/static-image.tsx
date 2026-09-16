import type { ImgHTMLAttributes } from 'react';

/** The site's images are unoptimized public files; Pages has no image server. */
export default function StaticImage({
  unoptimized: _unoptimized,
  alt,
  ...props
}: ImgHTMLAttributes<HTMLImageElement> & {
  unoptimized?: boolean;
  alt: string;
}) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img {...props} alt={alt} decoding="async" />;
}
