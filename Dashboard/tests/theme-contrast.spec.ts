import { test, expect, type Locator } from '@playwright/test';
import { e2eConfigured, establishCachedBrowserSession } from './e2e-auth';

type Sample = { name: string; ratio: number; minimum: number; foreground: string; background: number[] };

async function contrast(
  locator: Locator,
  name: string,
  minimum = 4.5,
  property: 'color' | 'borderTopColor' | 'outlineColor' = 'color',
  againstParent = false,
): Promise<Sample> {
  return locator.evaluate((element, options) => {
    type RGB = [number, number, number];
    const parse = (color: string): [number, number, number, number] => {
      const values = color.match(/[\d.]+/g)?.map(Number);
      if (!values || values.length < 3) throw new Error(`Unsupported computed color: ${color}`);
      return [values[0], values[1], values[2], values[3] ?? 1];
    };
    const background = (node: Element | null): RGB => {
      if (!node) return [255, 255, 255];
      const color = parse(getComputedStyle(node).backgroundColor);
      const under = background(node.parentElement);
      return [0, 1, 2].map(i => color[i] * color[3] + under[i] * (1 - color[3])) as RGB;
    };
    const luminance = (rgb: RGB) => rgb.map(value => value / 255)
      .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
      .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
    const fg = getComputedStyle(element)[options.property];
    const bg = background(options.againstParent ? element.parentElement : element);
    const paint = parse(fg);
    const composite = [0, 1, 2].map(i => paint[i] * paint[3] + bg[i] * (1 - paint[3])) as RGB;
    const pair = [luminance(composite), luminance(bg)].sort((a, b) => b - a);
    return { name: options.name, ratio: (pair[0] + 0.05) / (pair[1] + 0.05), minimum: options.minimum, foreground: fg, background: bg };
  }, { name, minimum, property, againstParent });
}

function assertContrast(samples: Sample[]) {
  const failures = samples.filter(sample => sample.ratio < sample.minimum);
  expect(failures, `Contrast failures: ${JSON.stringify(failures, null, 2)}`).toEqual([]);
}

test.beforeEach(async ({ page }) => {
  test.skip(!e2eConfigured(), 'Disposable backend credentials required');
  await establishCachedBrowserSession(page);
  await page.route('**/api/vehicles', route => route.fulfill({ json: [{ id: 'contrast-car', name: 'Contrast test vehicle' }] }));
});

test('rendered control styles meet contrast targets in Light and Dark, including hover and focus', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    const fixture = document.createElement('section');
    fixture.dataset.testid = 'theme-contrast-fixture';
    fixture.innerHTML = `
      <button class="btn-primary">Primary action</button>
      <button class="btn-danger">Delete action</button>
      <button class="btn-secondary">Secondary action</button>
      <div class="form-error">An error needs attention</div>
      <div class="data-freshness-outage">Connection unavailable</div>
      <div class="data-freshness-stale">Data is delayed</div>
      <div class="semantic-green" style="color: var(--accent-green); background: var(--accent-green-bg)">System healthy</div>
      <div class="semantic-amber" style="color: var(--accent-amber); background: var(--accent-amber-bg)">Action due soon</div>
      <a class="nav-link active" tabindex="0">Selected navigation</a>
      <button class="more-dropdown-item">Menu action</button>
      <button class="border-probe" style="border: 1px solid var(--border-strong); background: var(--surface); color: var(--text-primary)">Strong border</button>`;
    fixture.style.cssText = 'position:fixed;right:8px;bottom:8px;z-index:99999;width:320px;display:grid;gap:8px;background:var(--surface);padding:12px';
    document.body.appendChild(fixture);
  });
  const fixture = page.getByTestId('theme-contrast-fixture');
  const samples: Sample[] = [];
  for (const theme of ['light', 'dark']) {
    await page.mouse.move(0, 0);
    await page.evaluate(value => document.documentElement.setAttribute('data-theme', value), theme);
    for (const selector of ['.form-error', '.data-freshness-outage', '.data-freshness-stale', '.semantic-green', '.semantic-amber', '.nav-link']) {
      samples.push(await contrast(fixture.locator(selector), `${theme} ${selector}`));
    }
    samples.push(await contrast(fixture.locator('.border-probe'), `${theme} strong border`, 3, 'borderTopColor'));
    for (const selector of ['.btn-primary', '.btn-danger', '.btn-secondary', '.more-dropdown-item']) {
      const control = fixture.locator(selector);
      samples.push(await contrast(control, `${theme} ${selector} default`));
      const before = await control.evaluate(element => getComputedStyle(element).backgroundColor);
      await control.hover();
      expect(await control.evaluate(element => getComputedStyle(element).backgroundColor), `${theme} ${selector} hover must apply`).not.toBe(before);
      samples.push(await contrast(control, `${theme} ${selector} hover`));
    }
    await page.keyboard.press('Tab');
    const nav = fixture.locator('.nav-link');
    await nav.focus();
    await expect(nav).toBeFocused();
    expect(await nav.evaluate(element => getComputedStyle(element).outlineStyle)).not.toBe('none');
    samples.push(await contrast(nav, `${theme} keyboard focus`, 3, 'outlineColor', true));
  }
  assertContrast(samples);
  await test.info().attach('control-contrast', { body: JSON.stringify(samples, null, 2), contentType: 'application/json' });
});

test('Account theme label text and keyboard focus stay readable on selected tinted surfaces', async ({ page }) => {
  await page.goto('/account');
  const samples: Sample[] = [];
  for (const theme of ['Light', 'Dark']) {
    const radio = page.getByRole('radio', { name: theme, exact: true });
    await radio.check();
    await expect(radio).toBeChecked();
    for (const name of ['System', 'Light', 'Dark']) {
      const label = page.getByRole('radio', { name, exact: true }).locator('..');
      await label.hover();
      for (const text of await label.locator('.theme-option-content > span').all()) {
        samples.push(await contrast(text, `${theme} theme ${name} ${await text.innerText()}`));
      }
    }
    await page.keyboard.press('Tab');
    await radio.focus();
    const content = radio.locator('..').locator('.theme-option-content');
    expect(await content.evaluate(element => getComputedStyle(element).outlineStyle)).not.toBe('none');
    samples.push(await contrast(content, `${theme} selected theme focus`, 3, 'outlineColor', true));
  }
  assertContrast(samples);
  await test.info().attach('account-theme-contrast', { body: JSON.stringify(samples, null, 2), contentType: 'application/json' });
});
