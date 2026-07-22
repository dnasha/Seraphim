// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/ui/ThemeToggle', () => ({ default: () => <button>Theme</button> }));

import PublicPageHeader from '@/components/ui/PublicPageHeader';

describe('PublicPageHeader', () => {
  it('keeps the back destination separate while the SERAPHIM brand always links home', () => {
    render(<PublicPageHeader backHref="/account" />);

    expect(screen.getByRole('link', { name: 'Go back' }).getAttribute('href')).toBe('/account');
    const brand = screen.getByRole('link', { name: 'SERAPHIM home' });
    expect(brand.getAttribute('href')).toBe('/');
    expect(brand.textContent).toContain('SERAPHIM');
  });
});
