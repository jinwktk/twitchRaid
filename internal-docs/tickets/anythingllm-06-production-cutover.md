## Parent

#3

## What to build

shadow-writeとno-send probeから段階的に本番AI会話をAnythingLLMへ切り替え、精度・性能・障害・保持・rollbackの全gate通過後にSQLite/Mem0連携と不要サービスを撤去する。

## Acceptance criteria

- [ ] 固定image digest、revision、永続volume、secret、内部networkを本番で確認する
- [ ] shadow-write中に欠落、重複、queue遅延、既存Botへの影響がない
- [ ] no-send probeで記憶想起、再起動後履歴、明示検索、省略検索、修復生成を確認する
- [ ] 本番切替後に新規Twitch AI会話でAnythingLLM→Ollama経路を確認する
- [ ] WARN/ERROR/FATAL、restart、GPU常駐、RAM、disk、p50/p95を監視する
- [ ] rollbackがAI会話だけを旧経路へ戻し、固定機能へ影響しない
- [ ] 移行データと採用gateを再確認してからSQLite/Mem0の読書きを停止する
- [ ] 旧コード、設定、Memory WebUI、Mem0サービス、不要Qdrantデータを段階的に撤去する
- [ ] README、AGENTS、内部運用手順、backup/restore、障害対応を更新する
- [ ] 全テスト、build、lint、diff check、実本番ログ確認がgreenになる

## Blocked by

#6, #7, #8
