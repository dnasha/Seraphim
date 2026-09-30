/** Isolated fixture server: real HomeContent/sidebar/replay, mocked external services. */
import { createServer } from 'vite';
import { resolve } from 'node:path';
const root = resolve('scripts/fixtures/replay-browser');
const services = resolve(root, 'services.tsx');
const exports = {
    'next/dynamic': 'Dynamic', 'next/image': 'Image', 'next/link': 'Link',
    '@/components/auth/UserButton': 'Null', '@/components/ui/PWAInstallPrompt': 'Null',
};
const server = await createServer({
    configFile: false, root,
    server: { host: '127.0.0.1', port: 4175, strictPort: true, fs: { allow: [process.cwd()] } },
    esbuild: { jsx: 'automatic' },
    define: { 'process.env': '{}' },
    resolve: { alias: [
        ...Object.entries(exports).map(([find, name]) => ({ find, replacement: resolve(root, `${name}.tsx`) })),
        ...['next/navigation', 'next-themes', '@/hooks/useAuth', '@/hooks/useUserTier', '@/hooks/useNewsData', '@/hooks/useSyncedPreferences'].map(find => ({ find, replacement: services })),
        { find: '@', replacement: resolve('src') },
    ] },
});
await server.listen();
server.printUrls();
