import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

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
