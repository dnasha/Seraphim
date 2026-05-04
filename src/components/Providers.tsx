'use client';

/*
Providers component wraps the application with necessary context providers.
Currently manages the ThemeProvider for application-wide theme state.
*/

import { ThemeProvider } from 'next-themes';

export function Providers({ children }: { children: React.ReactNode }) {
    return (
        <ThemeProvider attribute="data-theme" defaultTheme="light" enableSystem={false}>
            {children}
        </ThemeProvider>
    );
}
