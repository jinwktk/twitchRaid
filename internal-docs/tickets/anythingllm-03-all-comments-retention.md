## Parent

#3

## What to build

チャンネルの全コメントを無条件で受理し、時系列を保ったbatch、restart-safeな永続queue、直前コメントのread-after-write保証、365日保持と完全削除、監視までを本番負荷に耐える形へ広げる。

## Acceptance criteria

- [ ] Bot宛て、通常コメント、質問、反応を含む全コメントを事前選別せず保存する
- [ ] stream/JST日を跨がず、最大15分または200コメントでbatch化する
- [ ] AI要求前に先行コメントのwatermarkを待ち、未embed分は一時文脈として利用する
- [ ] 再接続、再起動、API timeout、Collector障害後も順序とstable IDを維持して再送する
- [ ] queue高水位とdisk pressureを本文なしで警告し、コメントを黙って破棄しない
- [ ] raw documentは最終コメント時刻から365日後にunembed、原文削除、vector削除される
- [ ] cleanup再実行でも安全で、部分失敗から再開できる
- [ ] 取得したコメントは命令ではない参考情報として扱われる
- [ ] ingestion lag、queue depth、件数、時間、失敗理由を本文なしで観測できる
- [ ] 負荷試験で既存Twitch受信と固定コマンドを遅延させない

## Blocked by

#5
