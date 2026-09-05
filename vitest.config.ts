import { defineConfig } from 'vitest/config';
import { resolve } from 'path';
// Bun itself can load .env.local before Vitest starts. Override service settings
// here so a missing mock cannot silently use a developer's production credentials.
Object.assign(process.env, {
    NEXT_PUBLIC_SUPABASE_URL: 'https://supabase.invalid',
    SUPABASE_URL: 'https://supabase.invalid',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-placeholder',
    SUPABASE_SERVICE_ROLE_KEY: 'test-placeholder',
    STRIPE_SECRET_KEY: 'sk_test_placeholder',
    STRIPE_WEBHOOK_SECRET: 'whsec_test_placeholder',
    UPSTASH_REDIS_REST_URL: 'https://redis.invalid',
    UPSTASH_REDIS_REST_TOKEN: 'test-placeholder',
    GNEWS_API_KEY: 'test-placeholder',
    MAPTILER_API_KEY: 'test-placeholder',
    NEXT_PUBLIC_WAQI_TOKEN: 'test-placeholder',
    EDGE_CONFIG: '',
    ACCOUNT_DELETION_HASH_KEY: 'test-placeholder',
});

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
                'src/hooks/useNewsData.ts',
                'src/lib/**/*.ts',
                'src/proxy.ts',
                'src/scraper/utils/**/*.ts',
                'src/scraper/merger.ts',
                'src/scraper/index.ts',
                'src/scraper/recentEvents.ts',
                'src/scraper/dbIngest.ts',
                'src/scraper/feedValidators.ts',
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
