'use client';

/**
 * Providers component serves as the root wrapper for application-wide 
 * context providers. Authentication is scoped to routes that consume it.
 */

import { ThemeProvider } from 'next-themes';

export function Providers({ children }: { children: React.ReactNode }) {
    return (
        <ThemeProvider attribute="data-theme" defaultTheme="light" enableSystem={true}>
            {children}
        </ThemeProvider>
    );
}
