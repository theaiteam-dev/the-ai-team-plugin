/**
 * Secondary setup file that extends vitest 4.x's expect with @testing-library/jest-dom
 * matchers. This is needed because the primary setup.ts imports
 * '@testing-library/jest-dom/vitest' which resolves to vitest 1.x in this monorepo,
 * leaving vitest 4.x's expect without the DOM matchers.
 */
import { expect } from 'vitest';
// Use the matchers-only import to avoid the vitest peer dependency resolution issue
import * as jestDomMatchers from '@testing-library/jest-dom/matchers';

expect.extend(jestDomMatchers);
