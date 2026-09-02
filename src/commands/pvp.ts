export interface FrontlineRule {
  fullName: string;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
// https://ffxiv-frontline-calendar.tuyurukai.info/ のパッチ7.5以降の基準日。
const CURRENT_ROTATION_START_DAY = Math.floor(
  Date.UTC(2026, 3, 29) / MS_PER_DAY
);

const CURRENT_ROTATION: readonly FrontlineRule[] = [
  { fullName: "外縁遺跡群（制圧戦）" },
  { fullName: "オンサル・ハカイル（終節戦）" },
  { fullName: "ウォーコー・チーテ（演習戦）" },
  { fullName: "シールロック（争奪戦）" },
  { fullName: "フィールド・オブ・グローリー（砕氷戦）" },
  { fullName: "オンサル・ハカイル（終節戦）" },
  { fullName: "ウォーコー・チーテ（演習戦）" },
  { fullName: "シールロック（争奪戦）" },
];

export function getFrontlineRuleAt(instant: Date): FrontlineRule {
  const jstDay = Math.floor((instant.getTime() + JST_OFFSET_MS) / MS_PER_DAY);
  const dayOffset = jstDay - CURRENT_ROTATION_START_DAY;
  const index =
    ((dayOffset % CURRENT_ROTATION.length) + CURRENT_ROTATION.length) %
    CURRENT_ROTATION.length;
  return CURRENT_ROTATION[index];
}

export function formatTodayFrontlineRule(instant: Date = new Date()): string {
  const rule = getFrontlineRuleAt(instant);
  return `今日のフロントライン：${rule.fullName}`;
}
