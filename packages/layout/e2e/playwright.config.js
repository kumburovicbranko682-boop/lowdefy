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

import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig, devices } from '@playwright/test';

const e2eDir = path.dirname(fileURLToPath(import.meta.url));

// The grid layout relies on real browser CSS behaviour (custom-property
// inheritance, @media breakpoints, var() fallback chains and calc()), none of
// which jsdom evaluates. These specs render the real grid.css against a DOM
// built from deriveLayout's real output via page.setContent — no app server
// is required.
export default defineConfig({
  testDir: e2eDir,
  testMatch: ['*.e2e.spec.js'],
  fullyParallel: true,
  reporter: 'list',
  outputDir: path.join(e2eDir, 'test-results'),
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
