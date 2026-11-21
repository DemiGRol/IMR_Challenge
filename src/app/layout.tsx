import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'IMR BPMN Studio — Generador de Procesos BPMN 2.0',
  description:
    'Aplicación web para transformar descripciones de procesos de negocio en diagramas BPMN 2.0 editables con bpmn.io.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
