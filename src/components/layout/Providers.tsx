'use client';

/**
 * Providers component serves as the root wrapper for application-wide 
 * context providers. Configures theme management and authentication state.
 */

import { ThemeProvider } from 'next-themes';
import { AuthProvider } from '@/components/auth/AuthProvider';

export function Providers({ children }: { children: React.ReactNode }) {
    return (
        <ThemeProvider attribute="data-theme" defaultTheme="light" enableSystem={true}>
            <AuthProvider>
                {children}
            </AuthProvider>
        </ThemeProvider>
    );
}
