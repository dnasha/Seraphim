import { defineConfig } from 'vitest/config';
import { resolve } from 'path';
import { config } from 'dotenv';
import { expand } from 'dotenv-expand';

// Load environment variables from .env.local for tests
expand(config({ path: resolve(__dirname, '.env.local') }));

export default defineConfig({
    resolve: {
        alias: {
            '@': resolve(__dirname, 'src'),
            'server-only': resolve(__dirname, 'scripts/tests/mocks/server-only.ts'),
        },
    },
    test: {
        include: ['scripts/tests/**/*.test.{ts,tsx}'],
        testTimeout: 30_000,
        reporters: ['default'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'json-summary'],
            reportsDirectory: 'coverage',
            include: [
                'src/app/api/**/*.ts',
                'src/app/auth/**/*.ts',
                'src/components/map/utils.ts',
                'src/hooks/useResizable.ts',
                'src/hooks/useViewState.ts',
                'src/lib/**/*.ts',
                'src/proxy.ts',
                'src/scraper/utils/**/*.ts',
                'src/types/**/*.ts',
            ],
            exclude: [
                'src/lib/core/supabase-admin.ts',
                'src/lib/core/supabase.ts',
                'src/lib/supabase/**/*.ts',
                'src/lib/stripe.ts',
            ],
            thresholds: {
                global: {
                    statements: 70,
                    branches: 65,
                    functions: 75,
                    lines: 70,
                },
            },
        },
    },
});
