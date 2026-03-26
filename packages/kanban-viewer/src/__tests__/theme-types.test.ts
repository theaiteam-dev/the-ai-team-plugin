import { describe, it, expect } from 'vitest';
import { DARK_THEME_COLORS, WORK_ITEM_TYPE_BADGE_COLORS } from '../types';

describe('Theme Types', () => {
  describe('Color format validation', () => {
    it('should have all theme colors in valid hex format', () => {
      const hexColorRegex = /^#[0-9a-fA-F]{6}$/;

      // Background colors
      expect(DARK_THEME_COLORS.background.primary).toMatch(hexColorRegex);
      expect(DARK_THEME_COLORS.background.cards).toMatch(hexColorRegex);
      expect(DARK_THEME_COLORS.background.columns).toMatch(hexColorRegex);

      // Text colors
      expect(DARK_THEME_COLORS.text.primary).toMatch(hexColorRegex);
      expect(DARK_THEME_COLORS.text.secondary).toMatch(hexColorRegex);

      // Accent colors
      expect(DARK_THEME_COLORS.accent.success).toMatch(hexColorRegex);
      expect(DARK_THEME_COLORS.accent.warning).toMatch(hexColorRegex);
      expect(DARK_THEME_COLORS.accent.active).toMatch(hexColorRegex);
      expect(DARK_THEME_COLORS.accent.idle).toMatch(hexColorRegex);
    });

    it('should have all badge colors in valid hex format', () => {
      const hexColorRegex = /^#[0-9a-fA-F]{6}$/;

      expect(WORK_ITEM_TYPE_BADGE_COLORS.implementation).toMatch(hexColorRegex);
      expect(WORK_ITEM_TYPE_BADGE_COLORS.integration).toMatch(hexColorRegex);
      expect(WORK_ITEM_TYPE_BADGE_COLORS.interface).toMatch(hexColorRegex);
      expect(WORK_ITEM_TYPE_BADGE_COLORS.test).toMatch(hexColorRegex);
    });
  });
});
