## Parent

#3

## What to build

配信終了後に全コメントのingestion完了を確認し、長配信にも対応する階層要約と出典付き事実文書を無期限保存する。既存SQLiteとMem0の有効記憶を重複させずAnythingLLMへ移行する。

## Acceptance criteria

- [ ] stream offline後、最終ingestion watermark完了まで要約を開始しない
- [ ] 長配信を決定的な階層要約で処理し、stream ID単位で冪等に保存する
- [ ] 要約と事実抽出は専用sessionからAnythingLLM経由でOllamaを呼ぶ
- [ ] 配信要約と事実文書はraw documentの365日削除後も残る
- [ ] 事実は発言者、時刻、stream IDを出典として保持する
- [ ] 矛盾する事実を黙って上書きせず、時系列と出典を保持する
- [ ] SQLite activeと非重複Mem0記憶だけをmigration provenance付きで移す
- [ ] candidate、inactive、tombstone、unsafe、duplicateを昇格させない
- [ ] migration再実行でも要約、事実、文書が重複しない
- [ ] 移行前後の代表質問evalが記憶精度の非劣化基準を満たす

## Blocked by

#6, #7
