// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HoloraaApp } from './HoloraaApp';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  // Mock window.scrollTo
  window.scrollTo = vi.fn();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root.render(<HoloraaApp />);
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('HoloraaApp Component', () => {
  it('renders landing page by default with brand mark and hero headline', () => {
    expect(container.textContent).toContain('holoraa');
    expect(container.textContent).toContain('One quiet place for the');
    expect(container.textContent).toContain('Launch Web App');
  });

  it('links to /app from hero launch button without entering mock workspace', () => {
    const launchButton = Array.from(container.querySelectorAll('a')).find((el) =>
      el.textContent?.includes('Launch Web App')
    );
    expect(launchButton).toBeDefined();
    expect(launchButton?.getAttribute('href')).toBe('/app');

    // Verify mock workspace elements are never in the DOM
    expect(container.querySelector('[title*="Search People & Thoughts"]')).toBeNull();
    expect(container.textContent).not.toContain('People in your orbit');
  });

  it('contains external showcase navigation links and sections', () => {
    expect(container.querySelector('#section-chat')).toBeDefined();
    expect(container.querySelector('#section-spot')).toBeDefined();
    expect(container.querySelector('#section-spaces')).toBeDefined();
    expect(container.querySelector('#section-room')).toBeDefined();
    expect(container.querySelector('#principles')).toBeDefined();
    expect(container.querySelector('#holories')).toBeDefined();
  });
});
