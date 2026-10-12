import type { Metadata } from 'next';
import './globals.css';
import { publicAsset } from './public-asset';
export const metadata: Metadata = {
  title: 'LIU’S GATE · University of Glasgow',
  icons: { icon: publicAsset('/favicon.svg') },
  description:
    'LIU’S GATE (刘家门): PhD students supervised by Pengyuan Liu at the University of Glasgow, with Yunlong Liu and Qin Li, working on urban analytics and GeoAI. The site is built as a small city: people, research, publications and life at the Gate.',
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
