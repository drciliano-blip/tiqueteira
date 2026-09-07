import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Archivo, Inter } from 'next/font/google';

import './globals.css';

/** Títulos e números. Aguenta caixa alta de cartaz sem parecer genérica. */
const archivo = Archivo({
  variable: '--font-archivo',
  subsets: ['latin'],
  display: 'swap',
});

/** Corpo, formulário e dados de interface. */
const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: { default: 'Tiqueteira', template: '%s · Tiqueteira' },
  description: 'Ingressos para os melhores eventos.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" className={`${archivo.variable} ${inter.variable} h-full`}>
      <body className="min-h-full font-sans">{children}</body>
    </html>
  );
}
