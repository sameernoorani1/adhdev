import type { Metadata } from 'next';
import './globals.css';

// AD-145: base metadata. The tab title becomes `ADHDev — <Project>` once the
// client knows which project is active — that live update lives in
// FeedbackBoard. Keeping a sensible default here avoids the flash of
// project-less text on initial paint.
export const metadata: Metadata = {
  title: 'ADHDev',
  description: 'Track, trigger, and review AI coding work from a single board.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body>
        {children}
      </body>
    </html>
  );
}
