import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'Commute, connected',
  description: 'A weather-aware Bike–Bus–Bike plan for your Route 100 commute.',
  manifest: '/manifest.webmanifest',
  themeColor: '#0b7a5a',
  openGraph: {
    title: 'Commute, connected',
    description: 'Weather-aware Bike–Bus–Bike timing for Route 100.',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'Commute, connected — Bike, bus, bike' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Commute, connected',
    description: 'Weather-aware Bike–Bus–Bike timing for Route 100.',
    images: ['/og.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
