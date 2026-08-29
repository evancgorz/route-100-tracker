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
  title: 'Route 100 Watch',
  description: 'Live and learned arrival estimates for GoTriangle Route 100 between Meredith College and RTC.',
  manifest: '/manifest.webmanifest',
  themeColor: '#9f1f2d',
  openGraph: {
    title: 'Route 100 Watch',
    description: 'Live Route 100 estimates for Meredith ↔ RTC.',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'Route 100 Watch — Meredith to RTC' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Route 100 Watch',
    description: 'Live Route 100 estimates for Meredith ↔ RTC.',
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
