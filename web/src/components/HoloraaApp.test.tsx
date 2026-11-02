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

  it('transitions to 4-column workspace when Launch Web App button is clicked', () => {
    const launchButton = Array.from(container.querySelectorAll('button')).find((btn) =>
      btn.textContent?.includes('Launch Web App')
    );
    expect(launchButton).toBeDefined();

    act(() => {
      launchButton?.click();
    });

    // In workspace view: IconRail, Messages, and RightOrbitRail are visible
    expect(container.textContent).toContain('Messages');
    expect(container.textContent).toContain('People in your orbit');
  });

  it('switches between workspace tabs cleanly', () => {
    const launchButton = Array.from(container.querySelectorAll('button')).find((btn) =>
      btn.textContent?.includes('Launch Web App')
    );
    act(() => {
      launchButton?.click();
    });

    // Find tab buttons in IconRail
    const spotBtn = container.querySelector('button[title*="The Spot"]');
    expect(spotBtn).toBeDefined();

    act(() => {
      (spotBtn as HTMLButtonElement)?.click();
    });

    expect(container.textContent).toContain('The Spot');
  });
});
