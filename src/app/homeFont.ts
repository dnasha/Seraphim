import { Merriweather } from 'next/font/google';

export const merriweather = Merriweather({
  subsets: ['latin'],
  weight: ['400', '700'],
  style: ['normal'],
  variable: '--font-merriweather',
  display: 'swap',
  preload: false,
});
