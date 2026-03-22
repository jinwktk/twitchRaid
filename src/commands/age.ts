/**
 * 誕生日（8月14日）から現在の年齢を計算
 */
export function calculateAge(): number {
  const today = new Date();
  const birthYear = 1982;
  const birthMonth = 8; // 8月
  const birthDay = 14;

  let age = today.getFullYear() - birthYear;

  // 今年の誕生日をまだ迎えていない場合は1歳引く
  const monthNow = today.getMonth() + 1; // 0-indexed
  if (
    monthNow < birthMonth ||
    (monthNow === birthMonth && today.getDate() < birthDay)
  ) {
    age--;
  }

  return age;
}
