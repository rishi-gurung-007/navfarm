import {
  checkDaysOverlap,
  doLinesTargetSameSubject,
  findConflictingSchedulerLine,
  formatPeriod,
} from '@/components/console/production/scheduler-line-overlap';

describe('scheduler-line-overlap validation', () => {
  describe('formatPeriod', () => {
    it('formats stage close when end_day is null or empty', () => {
      expect(formatPeriod({ line_type: 'CONSUMPTION', start_day: 1, end_day: null })).toBe('Day 1 to Stage close');
      expect(formatPeriod({ line_type: 'CONSUMPTION', start_day: 1, end_day: '' })).toBe('Day 1 to Stage close');
    });

    it('formats explicit end day', () => {
      expect(formatPeriod({ line_type: 'CONSUMPTION', start_day: 1, end_day: 14 })).toBe('Day 1 to Day 14');
    });

    it('formats ONCE occurrence', () => {
      expect(formatPeriod({ line_type: 'CONSUMPTION', occurrence: 'ONCE', start_day: 3 })).toBe('Day 3 (Once)');
    });

    it('formats CUSTOM occurrence', () => {
      expect(formatPeriod({ line_type: 'CONSUMPTION', occurrence: 'CUSTOM', custom_days: [3, 7, 14] })).toBe('Days 3, 7, 14 (Custom)');
    });
  });

  describe('doLinesTargetSameSubject', () => {
    it('returns false if line_types differ', () => {
      expect(
        doLinesTargetSameSubject(
          { line_type: 'CONSUMPTION', item_id: 'item-1' },
          { line_type: 'OUTPUT', item_id: 'item-1' },
        ),
      ).toBe(false);
    });

    it('matches same item in CONSUMPTION lines', () => {
      expect(
        doLinesTargetSameSubject(
          { line_type: 'CONSUMPTION', item_id: 'item-1' },
          { line_type: 'CONSUMPTION', item_id: 'item-1' },
        ),
      ).toBe(true);

      expect(
        doLinesTargetSameSubject(
          { line_type: 'CONSUMPTION', item_id: 'item-1' },
          { line_type: 'CONSUMPTION', item_id: 'item-2' },
        ),
      ).toBe(false);
    });

    it('matches same resource in RESOURCE lines', () => {
      expect(
        doLinesTargetSameSubject(
          { line_type: 'RESOURCE', resource_id: 'res-1' },
          { line_type: 'RESOURCE', resource_id: 'res-1' },
        ),
      ).toBe(true);
    });
  });

  describe('checkDaysOverlap', () => {
    it('detects overlap when both are DAILY covering full stage', () => {
      expect(
        checkDaysOverlap(
          { line_type: 'CONSUMPTION', start_day: 1, end_day: null, occurrence: 'DAILY' },
          { line_type: 'CONSUMPTION', start_day: 1, end_day: null, occurrence: 'DAILY' },
        ),
      ).toBe(true);
    });

    it('detects non-overlapping phases for same item (e.g. Day 1-14 and Day 15-28)', () => {
      expect(
        checkDaysOverlap(
          { line_type: 'CONSUMPTION', start_day: 1, end_day: 14, occurrence: 'DAILY' },
          { line_type: 'CONSUMPTION', start_day: 15, end_day: 28, occurrence: 'DAILY' },
        ),
      ).toBe(false);
    });

    it('detects overlap when ranges intersect partially', () => {
      expect(
        checkDaysOverlap(
          { line_type: 'CONSUMPTION', start_day: 1, end_day: 14, occurrence: 'DAILY' },
          { line_type: 'CONSUMPTION', start_day: 10, end_day: 20, occurrence: 'DAILY' },
        ),
      ).toBe(true);
    });

    it('detects CUSTOM days overlapping with DAILY range', () => {
      expect(
        checkDaysOverlap(
          { line_type: 'CONSUMPTION', start_day: 1, end_day: 10, occurrence: 'DAILY' },
          { line_type: 'CONSUMPTION', occurrence: 'CUSTOM', custom_days: [3, 7] },
        ),
      ).toBe(true);

      expect(
        checkDaysOverlap(
          { line_type: 'CONSUMPTION', start_day: 1, end_day: 10, occurrence: 'DAILY' },
          { line_type: 'CONSUMPTION', occurrence: 'CUSTOM', custom_days: [15, 20] },
        ),
      ).toBe(false);
    });
  });

  describe('findConflictingSchedulerLine', () => {
    it('flags duplicate item on same overlapping period (user scenario from screenshot)', () => {
      const existing = [
        {
          line_type: 'CONSUMPTION',
          activity_name: 'Booster Vaccine',
          item_id: 'item-premix',
          item_label: 'Swine Vitamin & Trace Mineral Premix',
          occurrence: 'DAILY',
          start_day: 1,
          end_day: null,
          standard_qty: 13,
        },
      ];

      const candidate = {
        line_type: 'CONSUMPTION',
        activity_name: 'Booster Vaccine',
        item_id: 'item-premix',
        item_label: 'Swine Vitamin & Trace Mineral Premix',
        occurrence: 'DAILY',
        start_day: 1,
        end_day: null,
        standard_qty: 1.4,
      };

      const conflict = findConflictingSchedulerLine(candidate, existing, {
        items: [{ item_id: 'item-premix', item_name: 'Swine Vitamin & Trace Mineral Premix' }],
      });

      expect(conflict).not.toBeNull();
      expect(conflict?.message).toContain('Swine Vitamin & Trace Mineral Premix');
      expect(conflict?.message).toContain('Booster Vaccine');
      expect(conflict?.message).toContain('Day 1 to Stage close');
    });

    it('allows different items on same time period', () => {
      const existing = [
        {
          line_type: 'CONSUMPTION',
          activity_name: 'Booster Vaccine',
          item_id: 'item-premix',
          occurrence: 'DAILY',
          start_day: 1,
          end_day: null,
        },
      ];

      const candidate = {
        line_type: 'CONSUMPTION',
        activity_name: 'Morning Feed',
        item_id: 'item-lactation-feed',
        occurrence: 'DAILY',
        start_day: 1,
        end_day: null,
      };

      const conflict = findConflictingSchedulerLine(candidate, existing);
      expect(conflict).toBeNull();
    });
  });
});
