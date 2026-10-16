import { describe, expect, it } from 'vitest';
import { addCalendarDays, bangkokDateTime, latestDueSlot, slotFor } from '../src/lib/line/time';
import type { LineSettingsSnapshot } from '../src/lib/line/types';

const settings: LineSettingsSnapshot = {
  hospitalName: 'Hospital',
  wardName: 'Ward',
  reportFormat: 'standard',
  includeCapacityAndOccupancy: true,
  includeCategories: true,
  includeWorkloadHours: false,
  includeNote: true,
  lineEnabled: true,
  lineGroupId: 'group',
  nightSendTime: '08:00',
  morningSendTime: '16:00',
  afternoonSendTime: '00:00',
};

describe('LINE Asia/Bangkok schedule', () => {
  it('maps the midnight afternoon slot to the previous report date', () => {
    const slot = slotFor('2026-10-14', 'บ่าย', settings);
    expect(slot.scheduledAt).toEqual(bangkokDateTime('2026-10-15', '00:00'));
    expect(addCalendarDays('2026-10-14', 1)).toBe('2026-10-15');
  });

  it('selects only the latest due slot after a restart', () => {
    const now = bangkokDateTime('2026-10-15', '00:01');
    const latest = latestDueSlot(now, settings);
    expect(latest).toMatchObject({ reportDate: '2026-10-14', shift: 'บ่าย' });
  });

  it('uses a configured afternoon wall-clock time on the next date', () => {
    const custom = { ...settings, afternoonSendTime: '01:30' };
    const slot = slotFor('2026-10-14', 'บ่าย', custom);
    expect(slot.scheduledAt).toEqual(bangkokDateTime('2026-10-15', '01:30'));
  });

  it('keeps an afternoon time after the morning schedule on the report date', () => {
    const custom = { ...settings, afternoonSendTime: '23:30' };
    const slot = slotFor('2026-10-14', 'บ่าย', custom);
    expect(slot.scheduledAt).toEqual(bangkokDateTime('2026-10-14', '23:30'));
  });
});
