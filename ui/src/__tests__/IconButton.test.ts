import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { IconButton } from '../IconButton.js';

/**
 * The disabled-tooltip surfacing (v1.0.2 audit B3). Chromium suppresses `title`
 * on a disabled <button>, so a greyed rail tool showed NO hint on hover. The fix
 * wraps a disabled button in a span that carries the tooltip. `createElement`
 * (not JSX) keeps this a plain .ts unit with no transform config.
 */
const base = {
  icon: createElement('svg'),
  label: 'Add points',
  shortcut: '3',
  testId: 'mode-place-point',
  onClick: () => {},
};

const render = (props: Record<string, unknown>) =>
  renderToStaticMarkup(createElement(IconButton, { ...base, ...props }));

describe('IconButton — disabled tools still show a hover hint (B3)', () => {
  it('enabled: the button itself carries the label+shortcut title, no wrapper span', () => {
    const html = render({});
    expect(html).toContain('title="Add points (3)"');
    expect(html).not.toContain('<span title=');
    expect(html).not.toContain('disabled=');
  });

  it('disabled with a reason: a wrapping span carries the reason as the tooltip', () => {
    const html = render({ disabled: true, disabledReason: 'Calibrate the axes first' });
    // The span shows the "why"; the disabled button no longer repeats a title
    // Chromium would suppress anyway.
    expect(html).toContain('<span title="Calibrate the axes first"');
    expect(html).toContain('disabled');
    expect(html).not.toContain('title="Add points (3)"');
  });

  it('disabled without a reason: the span still shows the label so hover is never empty', () => {
    const html = render({ disabled: true });
    expect(html).toContain('<span title="Add points (3)"');
    expect(html).toContain('disabled');
  });
});
