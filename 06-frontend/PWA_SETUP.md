# PWA Setup

> **Implementation Time**: 2h  
> **Complexity**: Low  
> **Dependencies**: Next.js 14+

## Problem

Users want to "install" your web app. Mobile users want it on their home screen. You need app-like behavior without building native apps.

## Solution

Progressive Web App. Manifest file. Mobile meta tags. App-like experience in the browser.

## Implementation

### Web App Manifest

```typescript
// app/manifest.ts
import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "My SaaS App",
    short_name: "MySaaS",
    description: "Your app description here",
    start_url: '/dashboard',
    display: 'standalone',
    background_color: '#0f172a',
    theme_color: '#14b8a6',
    orientation: 'portrait-primary',
    
    icons: [
      {
        src: '/icons/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-maskable.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
    
    // App shortcuts (right-click menu on desktop, long-press on mobile)
    shortcuts: [
      {
        name: 'Dashboard',
        url: '/dashboard',
        description: 'Go to dashboard',
      },
      {
        name: 'Settings',
        url: '/settings',
        description: 'App settings',
      },
    ],
    
    categories: ['productivity', 'utilities'],
  };
}
```

### Root Layout Metadata

```typescript
// app/layout.tsx
import type { Metadata, Viewport } from 'next';

export const metadata: Metadata = {
  title: "My SaaS App",
  description: "Your app description",
  
  // Apple-specific
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: "MySaaS",
    // startupImage: ['/splash.png'], // Optional splash screens
  },
  
  applicationName: "MySaaS",
  
  // Open Graph (for sharing)
  openGraph: {
    title: "My SaaS App",
    description: "Your app description",
    type: 'website',
    siteName: "MySaaS",
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,  // Prevents zoom on input focus
  themeColor: '#14b8a6',
  viewportFit: 'cover', // For notched devices
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-neutral-900 text-neutral-cream min-h-screen">
        {children}
      </body>
    </html>
  );
}
```

### Icon Files Structure

```
public/
├── icons/
│   ├── icon-192.png      # Standard icon
│   ├── icon-512.png      # Large icon
│   ├── icon-maskable.png # Maskable (with padding)
│   └── icon.svg          # Vector icon
├── favicon.ico
└── apple-touch-icon.png  # 180x180 for iOS
```

### Safe Area Handling (Notched Devices)

```css
/* globals.css */

/* Safe area for bottom navigation */
.safe-area-bottom {
  padding-bottom: env(safe-area-inset-bottom, 0);
}

/* Safe area for top header */
.safe-area-top {
  padding-top: env(safe-area-inset-top, 0);
}

/* Full safe area padding */
.safe-area-all {
  padding-top: env(safe-area-inset-top, 0);
  padding-right: env(safe-area-inset-right, 0);
  padding-bottom: env(safe-area-inset-bottom, 0);
  padding-left: env(safe-area-inset-left, 0);
}
```

```typescript
// components/mobile/MobileNav.tsx
export function MobileNav() {
  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-neutral-800 border-t border-neutral-700 z-30 md:hidden safe-area-bottom">
      {/* Navigation items */}
    </nav>
  );
}
```

### Install Prompt (Optional)

```typescript
// hooks/useInstallPrompt.ts
'use client';

import { useState, useEffect } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function useInstallPrompt() {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);

  useEffect(() => {
    // Check if already installed
    if (window.matchMedia('(display-mode: standalone)').matches) {
      setIsInstalled(true);
      return;
    }

    const handler = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as BeforeInstallPromptEvent);
    };

    window.addEventListener('beforeinstallprompt', handler);

    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
    };
  }, []);

  const promptInstall = async () => {
    if (!installPrompt) return false;

    await installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;

    if (outcome === 'accepted') {
      setIsInstalled(true);
      setInstallPrompt(null);
    }

    return outcome === 'accepted';
  };

  return {
    canInstall: !!installPrompt && !isInstalled,
    isInstalled,
    promptInstall,
  };
}
```

```typescript
// components/InstallBanner.tsx
'use client';

import { useInstallPrompt } from '@/hooks/useInstallPrompt';

export function InstallBanner() {
  const { canInstall, promptInstall } = useInstallPrompt();

  if (!canInstall) return null;

  return (
    <div className="fixed bottom-20 left-4 right-4 bg-primary-600 text-white p-4 rounded-lg shadow-lg md:hidden">
      <p className="text-sm mb-2">Install our app for a better experience</p>
      <button
        onClick={promptInstall}
        className="w-full py-2 bg-white text-primary-600 rounded font-medium"
      >
        Install App
      </button>
    </div>
  );
}
```

## Icon Generation

Use a tool like [PWA Asset Generator](https://github.com/nicholasadamou/pwa-asset-generator) or create manually:

```bash
# Required sizes
- 192x192 (manifest)
- 512x512 (manifest)
- 180x180 (apple-touch-icon)
- 32x32 (favicon)
- 16x16 (favicon)
```

### Maskable Icon Guidelines

Maskable icons need a "safe zone" - the important content should be in the center 80%:

```
┌─────────────────────┐
│                     │
│   ┌───────────┐     │
│   │           │     │
│   │   LOGO    │     │  ← Safe zone (80%)
│   │           │     │
│   └───────────┘     │
│                     │
└─────────────────────┘
```

## Testing PWA

1. **Chrome DevTools** → Application → Manifest
2. **Lighthouse** → PWA audit
3. **Mobile** → Add to Home Screen

## Production Checklist

- [ ] manifest.ts with all required fields
- [ ] Icons in all required sizes
- [ ] Maskable icon with safe zone
- [ ] apple-touch-icon.png (180x180)
- [ ] viewport meta with viewportFit: cover
- [ ] Safe area CSS for notched devices
- [ ] Theme color matches brand
- [ ] Start URL points to main app page

## Related Patterns

- [Design Tokens](./DESIGN_TOKENS.md)
- [Mobile Components](./MOBILE_COMPONENTS.md)
