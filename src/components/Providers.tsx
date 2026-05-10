'use client';

/*
Providers component wraps the application with necessary context providers.
Currently manages the ThemeProvider for application-wide theme state.
*/

import { ThemeProvider } from 'next-themes';
import { useEffect } from 'react';

export function Providers({ children }: { children: React.ReactNode }) {
    useEffect(() => {
        if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
            window.addEventListener('load', () => {
                navigator.serviceWorker
                    .register('/sw.js')
                    .then((registration) => {
                        console.log('SW registered:', registration.scope);
                    })
                    .catch((error) => {
                        console.error('SW registration failed:', error);
                    });
            });
        }
    }, []);

    return (
        <ThemeProvider attribute="data-theme" defaultTheme="light" enableSystem={false}>
            {children}
        </ThemeProvider>
    );
}
