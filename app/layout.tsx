import type { Metadata } from 'next';
import './globals.css';
import { publicAsset } from './public-asset';
export const metadata: Metadata = {
  title: 'LIU’S GATE · Urban Intelligence Group',
  icons: { icon: publicAsset('/favicon.svg') },
  description:
    'LIU’S GATE, the Urban Intelligence Group at the University of Glasgow, led by Pengyuan Liu with Yunlong Liu and Qin Li. A research group built as a small city: people, research, publications and group life.',
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
