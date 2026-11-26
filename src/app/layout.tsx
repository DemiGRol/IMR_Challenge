import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-sans',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'IMR BPMN Studio — Generador de Procesos BPMN 2.0',
  description:
    'Aplicación web para transformar descripciones de procesos de negocio en diagramas BPMN 2.0 editables con bpmn.io.',
};

const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem('imr_theme');if(t!=='dark'&&t!=='light'){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}document.documentElement.dataset.theme=t;var f=localStorage.getItem('imr_font_size');if(f!=='sm'&&f!=='md'&&f!=='lg'){f='md';}document.documentElement.dataset.fontSize=f;}catch(e){document.documentElement.dataset.theme='light';document.documentElement.dataset.fontSize='md';}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es"
      className={`${inter.variable} ${jetbrainsMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
