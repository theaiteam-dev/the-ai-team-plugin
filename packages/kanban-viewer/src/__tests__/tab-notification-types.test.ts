import { describe, it, expect } from 'vitest';
import type { TabNotificationProps, NotificationDotProps } from '../types';

describe('Tab Notification Types', () => {
  describe('TabNotificationProps', () => {
    it('should require hasNotification boolean', () => {
      const props: TabNotificationProps = {
        hasNotification: true,
      };

      expect(props.hasNotification).toBe(true);
    });

    it('should accept optional count for badge display', () => {
      const withCount: TabNotificationProps = {
        hasNotification: true,
        count: 5,
      };

      expect(withCount.hasNotification).toBe(true);
      expect(withCount.count).toBe(5);
    });

    it('should allow count to be undefined for simple dot variant', () => {
      const simpleDot: TabNotificationProps = {
        hasNotification: true,
      };

      expect(simpleDot.count).toBeUndefined();
    });

    it('should handle no notification state', () => {
      const noNotification: TabNotificationProps = {
        hasNotification: false,
      };

      expect(noNotification.hasNotification).toBe(false);
    });

    it('should be compile-time type safe for hasNotification', () => {
      const invalid: TabNotificationProps = {
        // @ts-expect-error - hasNotification must be boolean, not string
        hasNotification: 'yes',
      };
      expect(invalid).toBeDefined();
    });

    it('should be compile-time type safe for count', () => {
      const invalid: TabNotificationProps = {
        hasNotification: true,
        // @ts-expect-error - count must be number, not string
        count: 'five',
      };
      expect(invalid).toBeDefined();
    });
  });

  describe('NotificationDotProps', () => {
    it('should require visible boolean', () => {
      const props: NotificationDotProps = {
        visible: true,
      };

      expect(props.visible).toBe(true);
    });

    it('should accept optional count for badge display', () => {
      const withCount: NotificationDotProps = {
        visible: true,
        count: 3,
      };

      expect(withCount.visible).toBe(true);
      expect(withCount.count).toBe(3);
    });

    it('should accept optional className for styling', () => {
      const withClassName: NotificationDotProps = {
        visible: true,
        className: 'custom-notification',
      };

      expect(withClassName.className).toBe('custom-notification');
    });

    it('should support all optional props together', () => {
      const fullProps: NotificationDotProps = {
        visible: true,
        count: 10,
        className: 'notification-badge',
      };

      expect(fullProps.visible).toBe(true);
      expect(fullProps.count).toBe(10);
      expect(fullProps.className).toBe('notification-badge');
    });

    it('should allow minimal props for simple dot variant', () => {
      const minimalDot: NotificationDotProps = {
        visible: true,
      };

      expect(minimalDot.visible).toBe(true);
      expect(minimalDot.count).toBeUndefined();
      expect(minimalDot.className).toBeUndefined();
    });

    it('should handle hidden state', () => {
      const hidden: NotificationDotProps = {
        visible: false,
      };

      expect(hidden.visible).toBe(false);
    });

    it('should be compile-time type safe for visible', () => {
      const invalid: NotificationDotProps = {
        // @ts-expect-error - visible must be boolean, not number
        visible: 1,
      };
      expect(invalid).toBeDefined();
    });

    it('should be compile-time type safe for className', () => {
      const invalid: NotificationDotProps = {
        visible: true,
        // @ts-expect-error - className must be string, not array
        className: ['class1', 'class2'],
      };
      expect(invalid).toBeDefined();
    });
  });

  describe('Type variants', () => {
    it('should support simple dot notification (no count)', () => {
      // Mimics: Human Input●
      const dotProps: NotificationDotProps = {
        visible: true,
      };

      expect(dotProps.visible).toBe(true);
      expect(dotProps.count).toBeUndefined();
    });

    it('should support count badge notification', () => {
      // Mimics: Human Input (3)
      const badgeProps: NotificationDotProps = {
        visible: true,
        count: 3,
      };

      expect(badgeProps.visible).toBe(true);
      expect(badgeProps.count).toBe(3);
    });

    it('should handle zero count edge case', () => {
      const zeroCount: NotificationDotProps = {
        visible: false,
        count: 0,
      };

      expect(zeroCount.visible).toBe(false);
      expect(zeroCount.count).toBe(0);
    });
  });
});
