import './global.css';
import { Providers } from '@/components/providers';
import { CHUNK_RELOAD_SCRIPT } from '@/utils/chunk-reload-script';

export const metadata = {
  title: 'NAVFarm',
  description: 'Universal Farm Management Software for Agriculture',
  icons: {
    icon: 'https://nav-cdn.pages.dev/images/favicon.png',
    shortcut: 'https://nav-cdn.pages.dev/images/favicon.png',
    apple: 'https://nav-cdn.pages.dev/images/favicon.png',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          id="theme-script"
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var p=localStorage.getItem("navfarm_theme");var t=(p==="light"||p==="dark")?p:(window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light");document.documentElement.setAttribute("data-theme",t);}catch(e){}})();`,
          }}
        />
        <script id="chunk-reload-script" dangerouslySetInnerHTML={{ __html: CHUNK_RELOAD_SCRIPT }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
