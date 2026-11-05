import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  icons: { icon: '/favicon.svg' },
  title: 'Aurum — интеллектуальная система торговых стратегий',
  description:
    'Интеллектуальная система поиска торговых стратегий и формирования торговых сигналов на основе искусственного интеллекта.',
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
