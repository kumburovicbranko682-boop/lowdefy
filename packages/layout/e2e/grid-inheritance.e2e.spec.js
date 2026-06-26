/*
  Copyright 2020-2026 Lowdefy, Inc

  Licensed under the Apache License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License.
  You may obtain a copy of the License at

      http://www.apache.org/licenses/LICENSE-2.0

  Unless required by applicable law or agreed to in writing, software
  distributed under the License is distributed on an "AS IS" BASIS,
  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  See the License for the specific language governing permissions and
  limitations under the License.
*/

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { test, expect } from '@playwright/test';
import deriveLayout from '../src/deriveLayout.js';

// The real shipped stylesheet. The fixtures below are built from deriveLayout's
// real output, so each spec exercises the full chain: deriveLayout → inline
// custom properties → grid.css → the browser's CSS cascade.
const gridCss = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/grid.css'),
  'utf8'
);

// 960 is divisible by 24, so each span unit is exactly 40px and expected widths
// are whole numbers regardless of the active breakpoint.
const ROOT_WIDTH = 960;

// Viewport widths chosen to land squarely inside each breakpoint band.
const VP = {
  base: { width: 500, height: 800 }, // < 640  (stacked)
  sm: { width: 700, height: 800 }, //   640–767
  md: { width: 900, height: 800 }, //   768–1023
  lg: { width: 1100, height: 800 }, //  1024–1279
  xl: { width: 1300, height: 800 }, //  >= 1280
};

function styleString(style) {
  return Object.entries(style)
    .map(([key, value]) => `${key}:${value}`)
    .join(';');
}

// Build a .lf-col exactly as BlockLayout would, using the real deriveLayout.
function col(layout, { testId, children = '' } = {}) {
  const { className, style } = deriveLayout(layout);
  const attr = testId ? ` data-testid="${testId}"` : '';
  return `<div class="${className}"${attr} style="${styleString(style)}">${children}</div>`;
}

function row(children) {
  return `<div class="lf-row">${children}</div>`;
}

async function mount(page, body) {
  await page.setContent(
    `<style>${gridCss}</style>` +
      `<div id="root" style="width:${ROOT_WIDTH}px;margin:0">${row(body)}</div>`
  );
}

function widthOf(page, testId) {
  return page
    .locator(`[data-testid="${testId}"]`)
    .evaluate((el) => el.getBoundingClientRect().width);
}

async function expectWidth(page, testId, expected) {
  const actual = await widthOf(page, testId);
  // Allow ~1px for sub-pixel rounding; the bug shifts widths by tens of px.
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(1.5);
}

test.describe('nested column responsive-span inheritance leak', () => {
  // Mirrors the reported bug: an outer column with lg.span:14 wrapping three
  // levels of default-span containers. At >= lg every nested column must fill
  // its parent (span 24), not collapse to the ancestor's 14/24 fraction.
  test('default-span columns fill their lg-spanned ancestor at lg', async ({ page }) => {
    const inner = col({}, { testId: 'view_company', children: 'content' });
    const box = col({}, { testId: 'content_box', children: row(inner) });
    const card = col({}, { testId: 'card', children: row(box) });
    const left = col(
      { sm: { span: 24 }, lg: { span: 14 } },
      { testId: 'left_side', children: row(card) }
    );
    await mount(page, left);

    const leftWidth = (14 / 24) * ROOT_WIDTH; // 560

    // lg: ancestor is 14/24 of the row; every nested default column must be the
    // full width of its parent (not 14/24 compounded per level).
    await page.setViewportSize(VP.lg);
    await expectWidth(page, 'left_side', leftWidth);
    await expectWidth(page, 'card', leftWidth);
    await expectWidth(page, 'content_box', leftWidth);
    await expectWidth(page, 'view_company', leftWidth);

    // md control (already correct before the fix): lg.span does not apply, so
    // the whole tree is full width.
    await page.setViewportSize(VP.md);
    await expectWidth(page, 'left_side', ROOT_WIDTH);
    await expectWidth(page, 'view_company', ROOT_WIDTH);

    // stacked control (< 768): full width.
    await page.setViewportSize(VP.base);
    await expectWidth(page, 'left_side', ROOT_WIDTH);
    await expectWidth(page, 'view_company', ROOT_WIDTH);
  });

  // xl falls back through lg in the var() chain, so an ancestor that declares
  // only lg must not leak into nested columns at xl either.
  test('default-span columns fill their ancestor at xl when ancestor declares only lg', async ({
    page,
  }) => {
    const inner = col({}, { testId: 'view_company', children: 'content' });
    const card = col({}, { testId: 'card', children: row(inner) });
    const left = col({ lg: { span: 14 } }, { testId: 'left_side', children: row(card) });
    await mount(page, left);

    const leftWidth = (14 / 24) * ROOT_WIDTH; // 560 (xl reads lg via fallback)

    await page.setViewportSize(VP.xl);
    await expectWidth(page, 'left_side', leftWidth);
    await expectWidth(page, 'card', leftWidth);
    await expectWidth(page, 'view_company', leftWidth);
  });

  // The sm var is also conditionally emitted, so an ancestor with sm.span:12
  // must not leak into nested default columns at sm.
  test('default-span columns fill their ancestor at sm when ancestor declares sm span', async ({
    page,
  }) => {
    const inner = col({}, { testId: 'view_company', children: 'content' });
    const card = col({}, { testId: 'card', children: row(inner) });
    const left = col({ sm: { span: 12 } }, { testId: 'left_side', children: row(card) });
    await mount(page, left);

    const leftWidth = (12 / 24) * ROOT_WIDTH; // 480

    await page.setViewportSize(VP.sm);
    await expectWidth(page, 'left_side', leftWidth);
    await expectWidth(page, 'card', leftWidth);
    await expectWidth(page, 'view_company', leftWidth);
  });

  // Regression: a nested column that declares its OWN lg.span must keep it.
  // The inline custom property must win over the inheritance-breaking reset.
  test('nested column with its own lg span keeps its own value', async ({ page }) => {
    const inner = col({ lg: { span: 6 } }, { testId: 'inner', children: 'content' });
    const left = col({ lg: { span: 14 } }, { testId: 'left_side', children: row(inner) });
    await mount(page, left);

    const leftWidth = (14 / 24) * ROOT_WIDTH; // 560
    const innerWidth = (6 / 24) * leftWidth; // 140 — its own span, not 560 nor a leak

    await page.setViewportSize(VP.lg);
    await expectWidth(page, 'left_side', leftWidth);
    await expectWidth(page, 'inner', innerWidth);
  });

  // Regression: within a single element the documented cascade still resolves.
  // A column declaring only sm.span applies it at sm and below, and reverts to
  // the top-level span default (24) from md upward.
  test('standalone column declaring only sm span resolves per the documented cascade', async ({
    page,
  }) => {
    const c = col({ sm: { span: 8 } }, { testId: 'c', children: 'content' });
    await mount(page, c);

    await page.setViewportSize(VP.sm);
    await expectWidth(page, 'c', (8 / 24) * ROOT_WIDTH); // 320

    await page.setViewportSize(VP.base);
    await expectWidth(page, 'c', (8 / 24) * ROOT_WIDTH); // 320 (sm cascades down to base)

    await page.setViewportSize(VP.lg);
    await expectWidth(page, 'c', ROOT_WIDTH); // 960 (md default; sm does not cascade up)
  });
});
