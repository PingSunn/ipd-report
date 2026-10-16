import type { CensusRecord } from "../types/census";

const unknownReporter = "ระบบ/ไม่ทราบผู้บันทึก";

export interface CensusAttributionDisplay {
  primary: string;
  secondary: string | null;
}

export function getCensusAttributionDisplay(record: CensusRecord): CensusAttributionDisplay {
  const creator = record.createdBy?.displayName.trim() || unknownReporter;
  const updater = record.updatedBy?.displayName.trim() || unknownReporter;
  const samePerson =
    (record.createdBy?.id !== null &&
      record.createdBy?.id !== undefined &&
      record.createdBy.id === record.updatedBy?.id) ||
    (record.createdBy?.id == null && record.updatedBy?.id == null);

  return {
    primary: `บันทึกโดย ${creator}`,
    secondary: samePerson ? null : `แก้ล่าสุดโดย ${updater}`,
  };
}
