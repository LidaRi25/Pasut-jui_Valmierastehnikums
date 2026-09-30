import type { Metadata, Viewport } from 'next';
import '@fontsource-variable/dm-sans/index.css';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Pieteikumu sistēma | Valmieras tehnikums', template: '%s | Valmieras tehnikums' },
  description: 'Valmieras tehnikuma pārtikas produktu un materiālu pieteikumu un pasūtījumu pārvaldības sistēma.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#ffffff',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="lv">
      <body>
        <a className="skip-link" href="#saturs">
          Pāriet uz saturu
        </a>
        {children}
      </body>
    </html>
  );
}
