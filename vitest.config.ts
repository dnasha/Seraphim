import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
    resolve: {
        alias: {
            '@': resolve(__dirname, 'src'),
        },
    },
    test: {
        include: ['scripts/tests/**/*.test.ts'],
        testTimeout: 30_000,
        reporters: ['default'],
    },
});
