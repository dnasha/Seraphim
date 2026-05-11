'use client';

/**
 * Providers component serves as the root wrapper for application-wide 
 * context providers. It currently configures the next-themes Provider 
 * for consistent theme management.
 */

import { ThemeProvider } from 'next-themes';

export function Providers({ children }: { children: React.ReactNode }) {
    return (
        <ThemeProvider attribute="data-theme" defaultTheme="light" enableSystem={false}>
            {children}
        </ThemeProvider>
    );
}
