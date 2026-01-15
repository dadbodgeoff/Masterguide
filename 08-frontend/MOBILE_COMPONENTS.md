# Mobile Components

> **Implementation Time**: 3h  
> **Complexity**: Low  
> **Dependencies**: None

## Problem

Desktop components don't work on mobile. Dropdowns are awkward. Navigation is hidden. Touch targets are too small. Mobile users deserve native-feeling interactions.

## Solution

Mobile-specific components. Bottom navigation. Bottom sheets. Touch-optimized interactions.

## Bottom Navigation

```typescript
// components/mobile/MobileNav.tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface NavItem {
  href: string;
  label: string;
  icon: string;
}

const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard', label: 'Home', icon: '🏠' },
  { href: '/map', label: 'Map', icon: '🗺️' },
  { href: '/alerts', label: 'Alerts', icon: '🔔' },
  { href: '/settings', label: 'Settings', icon: '⚙️' },
];

export function MobileNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-neutral-800 border-t border-neutral-700 z-30 md:hidden safe-area-bottom">
      <div className="flex items-center justify-around py-2">
        {NAV_ITEMS.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
          
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-col items-center gap-1 px-4 py-2 rounded-lg transition min-w-[64px] ${
                isActive
                  ? 'text-primary-400'
                  : 'text-neutral-500 hover:text-neutral-300'
              }`}
            >
              <span className="text-xl">{item.icon}</span>
              <span className="text-xs">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
```

## Bottom Sheet

```typescript
// components/mobile/BottomSheet.tsx
'use client';

import { useState, useRef, useEffect, ReactNode } from 'react';

interface BottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  children: ReactNode;
  title?: string;
  snapPoints?: number[]; // Heights as percentages [0.5, 0.9]
}

export function BottomSheet({
  isOpen,
  onClose,
  children,
  title,
  snapPoints = [0.5, 0.9],
}: BottomSheetProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [dragY, setDragY] = useState(0);
  const [currentSnap, setCurrentSnap] = useState(0);
  const sheetRef = useRef<HTMLDivElement>(null);
  const startY = useRef(0);
  const startHeight = useRef(0);

  // Lock body scroll when open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  const handleTouchStart = (e: React.TouchEvent) => {
    startY.current = e.touches[0].clientY;
    startHeight.current = sheetRef.current?.offsetHeight || 0;
    setIsDragging(true);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDragging) return;
    
    const currentY = e.touches[0].clientY;
    const diff = currentY - startY.current;
    
    // Only allow dragging down
    if (diff > 0) {
      setDragY(diff);
    }
  };

  const handleTouchEnd = () => {
    setIsDragging(false);
    
    // Close if dragged more than 100px
    if (dragY > 100) {
      onClose();
    }
    
    setDragY(0);
  };

  if (!isOpen) return null;

  const maxHeight = `${snapPoints[currentSnap] * 100}vh`;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 z-40 transition-opacity"
        onClick={onClose}
      />

      {/* Sheet */}
      <div
        ref={sheetRef}
        className="fixed bottom-0 left-0 right-0 bg-neutral-800 rounded-t-2xl z-50 overflow-hidden transition-transform"
        style={{
          maxHeight,
          transform: `translateY(${dragY}px)`,
          transition: isDragging ? 'none' : 'transform 0.3s ease-out',
        }}
      >
        {/* Drag Handle */}
        <div
          className="flex justify-center py-3 cursor-grab active:cursor-grabbing touch-none"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <div className="w-10 h-1 bg-neutral-600 rounded-full" />
        </div>

        {/* Header */}
        {title && (
          <div className="px-4 pb-3 border-b border-neutral-700">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-neutral-cream">{title}</h2>
              <button
                onClick={onClose}
                className="p-2 text-neutral-500 hover:text-neutral-300 transition"
                aria-label="Close"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        )}

        {/* Content */}
        <div className="overflow-y-auto p-4" style={{ maxHeight: `calc(${maxHeight} - 60px)` }}>
          {children}
        </div>
      </div>
    </>
  );
}
```

## Pull to Refresh

```typescript
// components/mobile/PullToRefresh.tsx
'use client';

import { useState, useRef, ReactNode } from 'react';

interface PullToRefreshProps {
  onRefresh: () => Promise<void>;
  children: ReactNode;
}

export function PullToRefresh({ onRefresh, children }: PullToRefreshProps) {
  const [isPulling, setIsPulling] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const startY = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const THRESHOLD = 80;

  const handleTouchStart = (e: React.TouchEvent) => {
    // Only enable pull-to-refresh at top of scroll
    if (containerRef.current?.scrollTop === 0) {
      startY.current = e.touches[0].clientY;
      setIsPulling(true);
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isPulling || isRefreshing) return;

    const currentY = e.touches[0].clientY;
    const diff = currentY - startY.current;

    if (diff > 0) {
      // Apply resistance
      const distance = Math.min(diff * 0.5, THRESHOLD * 1.5);
      setPullDistance(distance);
    }
  };

  const handleTouchEnd = async () => {
    if (!isPulling) return;

    if (pullDistance >= THRESHOLD && !isRefreshing) {
      setIsRefreshing(true);
      setPullDistance(THRESHOLD);

      try {
        await onRefresh();
      } finally {
        setIsRefreshing(false);
      }
    }

    setIsPulling(false);
    setPullDistance(0);
  };

  return (
    <div
      ref={containerRef}
      className="h-full overflow-y-auto"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Pull indicator */}
      <div
        className="flex items-center justify-center transition-all overflow-hidden"
        style={{ height: pullDistance }}
      >
        {isRefreshing ? (
          <div className="animate-spin w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full" />
        ) : (
          <div
            className="text-neutral-500 transition-transform"
            style={{
              transform: `rotate(${Math.min(pullDistance / THRESHOLD, 1) * 180}deg)`,
            }}
          >
            ↓
          </div>
        )}
      </div>

      {children}
    </div>
  );
}
```

## Touch-Friendly List Item

```typescript
// components/mobile/ListItem.tsx
'use client';

import { ReactNode } from 'react';

interface ListItemProps {
  children: ReactNode;
  onClick?: () => void;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  subtitle?: string;
}

export function ListItem({
  children,
  onClick,
  leftIcon,
  rightIcon,
  subtitle,
}: ListItemProps) {
  const Component = onClick ? 'button' : 'div';

  return (
    <Component
      onClick={onClick}
      className={`
        w-full flex items-center gap-3 px-4 py-3
        ${onClick ? 'active:bg-neutral-700/50 cursor-pointer' : ''}
        border-b border-neutral-700/50 last:border-b-0
      `}
    >
      {leftIcon && (
        <div className="flex-shrink-0 w-10 h-10 flex items-center justify-center rounded-full bg-neutral-700">
          {leftIcon}
        </div>
      )}

      <div className="flex-1 min-w-0 text-left">
        <div className="text-neutral-cream truncate">{children}</div>
        {subtitle && (
          <div className="text-sm text-neutral-500 truncate">{subtitle}</div>
        )}
      </div>

      {rightIcon && (
        <div className="flex-shrink-0 text-neutral-500">
          {rightIcon}
        </div>
      )}
    </Component>
  );
}
```

## Swipe Actions

```typescript
// components/mobile/SwipeableRow.tsx
'use client';

import { useState, useRef, ReactNode } from 'react';

interface SwipeableRowProps {
  children: ReactNode;
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  leftAction?: ReactNode;
  rightAction?: ReactNode;
}

export function SwipeableRow({
  children,
  onSwipeLeft,
  onSwipeRight,
  leftAction,
  rightAction,
}: SwipeableRowProps) {
  const [translateX, setTranslateX] = useState(0);
  const startX = useRef(0);
  const isDragging = useRef(false);

  const THRESHOLD = 80;

  const handleTouchStart = (e: React.TouchEvent) => {
    startX.current = e.touches[0].clientX;
    isDragging.current = true;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDragging.current) return;

    const currentX = e.touches[0].clientX;
    const diff = currentX - startX.current;

    // Limit swipe distance
    const maxSwipe = 100;
    const limitedDiff = Math.max(-maxSwipe, Math.min(maxSwipe, diff));
    setTranslateX(limitedDiff);
  };

  const handleTouchEnd = () => {
    isDragging.current = false;

    if (translateX > THRESHOLD && onSwipeRight) {
      onSwipeRight();
    } else if (translateX < -THRESHOLD && onSwipeLeft) {
      onSwipeLeft();
    }

    setTranslateX(0);
  };

  return (
    <div className="relative overflow-hidden">
      {/* Left action (revealed on swipe right) */}
      {leftAction && (
        <div className="absolute left-0 top-0 bottom-0 flex items-center px-4 bg-green-600">
          {leftAction}
        </div>
      )}

      {/* Right action (revealed on swipe left) */}
      {rightAction && (
        <div className="absolute right-0 top-0 bottom-0 flex items-center px-4 bg-red-600">
          {rightAction}
        </div>
      )}

      {/* Main content */}
      <div
        className="relative bg-neutral-800 transition-transform"
        style={{
          transform: `translateX(${translateX}px)`,
          transition: isDragging.current ? 'none' : 'transform 0.2s ease-out',
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {children}
      </div>
    </div>
  );
}
```

## Usage Example

```typescript
// app/dashboard/page.tsx
'use client';

import { useState } from 'react';
import { MobileNav } from '@/components/mobile/MobileNav';
import { BottomSheet } from '@/components/mobile/BottomSheet';
import { PullToRefresh } from '@/components/mobile/PullToRefresh';
import { ListItem } from '@/components/mobile/ListItem';

export default function DashboardPage() {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<string | null>(null);

  const handleRefresh = async () => {
    await new Promise(resolve => setTimeout(resolve, 1000));
    // Refetch data
  };

  return (
    <div className="min-h-screen pb-20 md:pb-0">
      <PullToRefresh onRefresh={handleRefresh}>
        <div className="p-4">
          <h1 className="text-2xl font-bold mb-4">Dashboard</h1>

          {items.map((item) => (
            <ListItem
              key={item.id}
              onClick={() => {
                setSelectedItem(item.id);
                setSheetOpen(true);
              }}
              leftIcon={<span>{item.icon}</span>}
              rightIcon={<span>→</span>}
              subtitle={item.subtitle}
            >
              {item.title}
            </ListItem>
          ))}
        </div>
      </PullToRefresh>

      <BottomSheet
        isOpen={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title="Details"
      >
        <p>Details for {selectedItem}</p>
      </BottomSheet>

      <MobileNav />
    </div>
  );
}
```

## Touch Target Guidelines

- Minimum touch target: 44x44px (Apple) / 48x48dp (Google)
- Spacing between targets: 8px minimum
- Use `active:` states for touch feedback

## Production Checklist

- [ ] Bottom nav with safe-area-bottom
- [ ] Touch targets ≥ 44px
- [ ] Active states on all interactive elements
- [ ] Bottom sheet for mobile modals
- [ ] Pull-to-refresh where appropriate
- [ ] Swipe actions for list items

## Related Patterns

- [Design Tokens](./DESIGN_TOKENS.md)
- [PWA Setup](./PWA_SETUP.md)
