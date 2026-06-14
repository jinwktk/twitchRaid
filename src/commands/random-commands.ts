/**
 * ランダム系コマンド（game, weight, height, mood, menu）
 */

const GAMES = [
  "Minecraft",
  "League of Legends",
  "VALORANT",
  "Apex Legends",
  "Overwatch 2",
  "Street Fighter 6",
  "Splatoon 3",
  "Among Us",
  "Fall Guys",
  "Dead by Daylight",
  "Phasmophobia",
  "Lethal Company",
  "Monster Hunter Wilds",
  "ELDEN RING",
  "DARK SOULS III",
  "SEKIRO: SHADOWS DIE TWICE",
  "Hollow Knight",
  "Celeste",
  "Hades",
  "Stardew Valley",
  "Terraria",
  "Core Keeper",
  "Palworld",
  "7 Days to Die",
  "The Forest",
  "Raft",
  "Euro Truck Simulator 2",
  "PowerWash Simulator",
  "Supermarket Simulator",
  "Unpacking",
  "Slay the Spire",
  "Balatro",
  "Vampire Survivors",
  "Inscryption",
  "The Binding of Isaac: Rebirth",
  "Portal 2",
  "It Takes Two",
  "Human: Fall Flat",
  "Little Nightmares",
  "Outer Wilds",
];

export function randomGame(): string {
  const game = GAMES[Math.floor(Math.random() * GAMES.length)];
  return `次に遊ぶゲーム候補：${game}`;
}

export function randomWeight(): string {
  const weight = Math.floor(Math.random() * 186) + 15; // 15-200
  return `${weight}kg`;
}

export function randomHeight(): string {
  const height = Math.floor(Math.random() * 101) + 120; // 120-220
  return `${height}cm`;
}

const MOODS = [
  "絶好調！",
  "眠い...",
  "お腹すいた",
  "やる気MAX",
  "ダルい",
  "ハッピー♪",
  "ちょっと疲れた",
  "最高の気分",
  "普通",
  "テンション低め",
  "無敵モード",
  "まったり",
  "ワクワク",
  "ぼんやり",
  "元気いっぱい",
];

export function randomMood(): string {
  const mood = MOODS[Math.floor(Math.random() * MOODS.length)];
  return `今日の気分：${mood}`;
}

const FOODS = [
  "ラーメン", "カレー", "寿司", "ピザ", "ハンバーガー", "パスタ",
  "うどん", "そば", "焼肉", "唐揚げ", "オムライス", "チャーハン",
  "サンドイッチ", "お好み焼き", "たこ焼き", "親子丼", "天ぷら",
  "しゃぶしゃぶ", "餃子", "麻婆豆腐", "牛丼", "豚丼", "かつ丼",
  "海鮮丼", "中華丼", "ステーキ", "ハンバーグ", "生姜焼き", "回鍋肉",
  "青椒肉絲", "酢豚", "エビチリ", "麻婆茄子", "八宝菜", "春巻き",
  "小籠包", "焼き鳥", "刺身", "鉄火丼",
  "ちらし寿司", "握り寿司", "海苔巻き", "いなり寿司", "手巻き寿司",
  "煮物", "肉じゃが", "筑前煮", "角煮", "手羽先", "鶏の照り焼き",
  "魚の煮付け", "刺身定食", "焼き魚定食", "とんかつ", "チキンカツ",
  "メンチカツ", "コロッケ", "エビフライ", "アジフライ", "イカリング",
  "グラタン", "ドリア", "リゾット", "スパゲッティ", "ペンネ",
  "ラザニア", "ニョッキ", "カルボナーラ", "ペペロンチーノ", "ボロネーゼ",
];

export function randomMenu(): string {
  const food = FOODS[Math.floor(Math.random() * FOODS.length)];
  return `今日のおすすめ：${food}`;
}
