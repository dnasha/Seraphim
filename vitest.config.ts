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
        include: ['scripts/tests/**/*.test.ts'],
        testTimeout: 30_000,
        reporters: ['default'],
    },
});
