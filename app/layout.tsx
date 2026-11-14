import type { Metadata } from 'next';
import './fonts.css';
import './globals.css';
import { publicAsset } from './public-asset';
export const metadata: Metadata = {
  title: 'LIU’S GATE · University of Glasgow',
  icons: { icon: publicAsset('/favicon.svg') },
  description:
    'LIU’S GATE (刘家门): PhD students supervised by Pengyuan Liu at the University of Glasgow, with Yunlong Liu and Qin Li, working on urban analytics and GeoAI. The site is built as a small city: people, research, publications and life at the Gate.',
  // The share card, as index.html's (which the published site serves): absolute URLs on the public
  // domain, as link previews need them.
  openGraph: {
    type: 'website',
    siteName: 'LIU’S GATE',
    title: 'LIU’S GATE · 刘家门',
    description:
      'GeoAI · Analytics · Topology · Environments. PhD students supervised by Pengyuan Liu at the University of Glasgow. The site is built as a small city: people, research, publications and life at the Gate.',
    url: 'https://liugate.uk/',
    locale: 'en_GB',
    images: [
      {
        url: 'https://liugate.uk/og-image.jpg',
        type: 'image/jpeg',
        width: 1200,
        height: 630,
        alt: 'LIU’S GATE (刘家门), University of Glasgow: GeoAI · Analytics · Topology · Environments, beside the small island town the site is built as.',
      },
    ],
  },
  twitter: { card: 'summary_large_image' },
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
