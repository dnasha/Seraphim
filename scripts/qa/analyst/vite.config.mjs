import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('.', import.meta.url));
const repo = resolve(root, '../../..');
const fixture = resolve(root, 'fixture.tsx');
const baseline = process.env.ANALYST_QA_BASELINE === '1';
const baselinePath = resolve(repo, 'src/components/layout/.analyst-baseline-HomeContent.tsx');
const config = {
  root,
  cacheDir: baseline ? '/tmp/analyst-vite-baseline-cache' : '/tmp/analyst-vite-feature-cache',
  resolve: { alias: [
    ...(baseline ? [{ find: '@/components/layout/HomeContent', replacement: baselinePath }] : []),
    ...['@/hooks/useAuth', '@/hooks/useUserTier', '@/hooks/useNewsData', '@/hooks/useViewState', '@/hooks/useSyncedPreferences', 'next/dynamic', 'next-themes', 'next/navigation'].map(find => ({ find, replacement: fixture })),
    ...['next/image', '@/components/auth/UserButton', '@/components/ui/ThemeToggle', '@/components/ui/PWAInstallPrompt'].map(find => ({ find, replacement: resolve(root, 'empty.tsx') })),
    { find: 'next/link', replacement: resolve(root, 'link.tsx') },
    { find: '@', replacement: resolve(repo, 'src') },
  ] },
  esbuild: { jsx: 'automatic' },
  server: { host: '127.0.0.1', port: baseline ? 4181 : 4179, strictPort: true, fs: { allow: [repo, baselinePath] } },
};

export default config;
