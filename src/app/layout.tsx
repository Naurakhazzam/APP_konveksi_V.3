import type { Metadata } from 'next';
import { Inter, Geist } from 'next/font/google';
import QueryProvider from '@/components/providers/QueryProvider';
import './globals.css';
import { cn } from "@/lib/utils";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Stitchlyx Syncore',
  description: 'Garment Management System',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="id" className={cn("h-full", "antialiased", inter.variable, "font-sans", geist.variable)}>
      <body className="min-h-full flex flex-col font-sans">
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}
