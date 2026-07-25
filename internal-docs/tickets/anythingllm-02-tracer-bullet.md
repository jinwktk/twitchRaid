## Parent

#3

## What to build

通常コメント1件を永続ledger付きでAnythingLLMへ保存し、新しいBotインスタンスのAI会話でその内容をAnythingLLMから想起する最小の縦切りを作る。同じ経路で、省略した「調べて」の対象を時系列カーソルから復元し、SearXNGの結果をAnythingLLM経由のOllama回答へ渡す。

## Acceptance criteria

- [ ] 通常コメントはTwitch返信を発生させず、stable ID付きで永続queueへ受理される
- [ ] batch upload成功とworkspace embed状態がledgerへ記録される
- [ ] upload応答喪失後のretryでもdocumentとchunkが重複しない
- [ ] Botを新規作成しても`!chat さっき何の話？`が保存コメントを参照する
- [ ] 別viewerの割込み後でも「調べて」が正しい直前AI話題を復元する
- [ ] 明示検索はSearXNGを1回呼び、`found / no_result / failed`を区別する
- [ ] 回答生成はAnythingLLMからOllamaを呼び、BotはOllamaを直接呼ばない
- [ ] AnythingLLM停止時も固定コマンドは正常で、AI会話は明示的な失敗応答になる
- [ ] Bot公開境界の再現テストがREDからGREENになる

## Blocked by

#4
