## Parent

#3

## What to build

`!chat`とBot宛てメンションの主生成、英語修復、歌詞修復をAnythingLLM経由のOllamaへ移し、現在のTwitch出力契約を変えずに永続チャンネル記憶をすべてのAI回答へ適用する。

## Acceptance criteria

- [ ] 主生成はstable channel sessionを使うAnythingLLM workspace chatで行う
- [ ] 英語修復と歌詞修復はno-memory utility sessionでAnythingLLMからOllamaを呼ぶ
- [ ] 固定返信、コマンド実行拒否、歌詞`【歌】`契約、英語境界、500文字上限を維持する
- [ ] 全コメントからの関連RAG結果が発言者付きで回答文脈へ入る
- [ ] prompt injectionコメントがsystem指示を変更しない
- [ ] AnythingLLM timeout、不正応答、Ollama失敗で既存のbounded failure replyを返す
- [ ] final cutover時はBotからOllamaへの直接生成呼出しが0件になる
- [ ] Consoleへprompt、コメント、記憶、回答、credential本文を出さない
- [ ] p50/p95とcold/warm latencyが採用基準内に収まる

## Blocked by

#5
