# Gemma 4 hardware feasibility / 2026-07-17

## Question

As of 2026-07-17, is Gemma 4 officially released, and what do the official sources say about model types, parameter sizes, context windows, quantization, memory footprint, and Ollama support?

## Request type

Current best-practice research, based on official upstream documentation only.

## Direct answer

Yes. Gemma 4 is officially released as of 2026-07-17.

- Google announced Gemma 4 on 2026-04-02.
- The official model card documents five sizes: E2B, E4B, 12B, 26B A4B, and 31B.
- The family is multimodal:
  - text and image for all models
  - audio for E2B, E4B, and 12B
  - video support is described in the model card core capabilities
- Context windows:
  - 128K for E2B and E4B
  - 256K for 12B, 26B A4B, and 31B
- Official small-model guidance says the smaller models are intended for efficient local execution on laptops and mobile devices.
- Google’s 12B launch post says Gemma 4 12B can run locally with 16GB of VRAM or unified memory, and also with 16GB of RAM.
- Google’s QAT post says the new QAT checkpoints are designed to reduce memory requirements; the core table lists Gemma 4 E2B mobile text-only at 0.84GB, while the QAT blog describes the mobile format as roughly 1GB for E2B.
- Ollama officially supports Gemma 4 in its library and release notes, including `gemma4`, `e2b`, `e4b`, `12b`, `26b`, `31b`, MLX variants, and QAT tags.
- Google’s Gemma 4 core docs also include an explicit “Gemma 4 Inference Memory Requirements” table that gives approximate load-time GPU/TPU memory needs with 20% overhead: Q4_0 is 2.9GB for E2B, 4.5GB for E4B, 6.7GB for 12B, 14.4GB for 26B A4B, and 17.5GB for 31B.

## What this means for a PC

Practical fit depends on which Gemma 4 size you want to run:

- E2B / E4B: the official docs position these as edge / laptop-friendly models.
- 12B: Google explicitly says 16GB RAM or 16GB VRAM / unified memory is enough for local use.
- 26B A4B: official docs describe it as a workstation / consumer GPU target, with 256K context and 25.2B total / 3.8B active parameters.
- 31B: official docs place it in the workstation / consumer GPU class.

For the larger models, the exact RAM/VRAM requirement depends on:

- the checkpoint variant
- whether you use QAT / quantized weights
- context length
- image/audio enabled or text-only use
- the runtime backend and offload behavior

Google’s memory table is the best official “load the model” guide, but Google explicitly warns that the numbers can change with inference tool and environment. It is a model-loading estimate, not a guarantee of end-to-end runtime headroom.

Ollama’s tag sizes are different again: they are distribution/download sizes for the packaged artifacts, not an official VRAM guarantee. The official tags page currently lists:

- `gemma4:e2b-it-qat` 4.3GB
- `gemma4:e4b-it-qat` 6.1GB
- `gemma4:12b-it-qat` 7.2GB
- `gemma4:26b-a4b-it-qat` 16GB
- `gemma4:31b-it-qat` 19GB

## Official sources

- Gemma 4 launch blog: https://blog.google/innovation-and-ai/technology/developers-tools/gemma-4/
  - Published 2026-04-02
  - Announces Gemma 4 as Google’s most intelligent open models to date
- Gemma 4 model card: https://ai.google.dev/gemma/docs/core/model_card_4
  - Last updated 2026-06-26
  - Documents model sizes, parameter counts, modalities, context windows, and deployment targets
- Gemma 4 12B launch blog: https://blog.google/innovation-and-ai/technology/developers-tools/introducing-gemma-4-12B/
  - Published 2026-06-03
  - Explicitly says 12B runs locally with 16GB of VRAM or unified memory, and with 16GB of RAM
- Gemma 4 QAT blog: https://blog.google/innovation-and-ai/technology/developers-tools/quantization-aware-training-gemma-4/
  - Published 2026-06-05
  - Says QAT checkpoints reduce memory requirements and that the mobile format can reduce Gemma 4 E2B to about 1GB; the core table lists E2B mobile text-only at 0.84GB
- Ollama Gemma 4 library page: https://registry.ollama.com/library/gemma4
  - Shows official Gemma 4 model tags, contexts, and package sizes
- Ollama Gemma 4 tags page: https://ollama.com/library/gemma4/tags
  - Shows QAT distribution sizes for the `*-it-qat` tags
- Ollama releases: https://github.com/ollama/ollama/releases
  - v0.30.3 adds `gemma4:12b`
  - v0.30.6 adds Gemma 4 QAT weights and `-qat` tags

## Relevant model facts

### Google model card

- E2B: 2.3B effective parameters, 5.1B with embeddings, 128K context
- E4B: 4.5B effective parameters, 8B with embeddings, 128K context
- 12B Unified: 11.95B parameters, 256K context
- 26B A4B MoE: 25.2B total parameters, 3.8B active parameters, 256K context
- 31B Dense: 30.7B parameters, 256K context

### Ollama library page

- `gemma4:e2b` 7.2GB, 128K context
- `gemma4:e4b` 9.6GB, 128K context
- `gemma4:12b` 7.6GB, 256K context
- `gemma4:26b` 18GB, 256K context
- `gemma4:31b` 20GB, 256K context

These Ollama sizes are package/download sizes and are not a full official runtime-memory guarantee.

### Ollama QAT tags

- `gemma4:e2b-it-qat` 4.3GB
- `gemma4:e4b-it-qat` 6.1GB
- `gemma4:12b-it-qat` 7.2GB
- `gemma4:26b-a4b-it-qat` 16GB
- `gemma4:31b-it-qat` 19GB

These are also distribution sizes, not a promise that the same amount of VRAM/RAM is sufficient in every runtime.

## Verified twitchRaid sub-PC snapshot

Read-only checks were taken on 2026-07-17 from 21:32 to 21:36 JST. No service, model, or configuration was changed.

- CPU: Intel Core i7-10700, 8 cores / 16 threads
- Host physical RAM: 31.90GiB total, 22.60GiB available at the time of capture
- WSL/Docker memory: 18.55GiB total, about 16GiB available
- GPU: NVIDIA GeForce RTX 2070 SUPER, 8,192MiB total
- GPU memory at 21:36:22 JST: 203MiB reserved, 7,966MiB used, 24MiB free (1MiB display-rounding difference)
- NVIDIA driver: 591.86; CUDA compatibility reported by `nvidia-smi`: 13.1
- Ollama: 0.30.10, which is newer than the 0.30.6 release that added the official Gemma 4 QAT tags
- Loaded Ollama models:
  - `qwen3.5:9b`: about 6.3GB, loaded as 20% CPU / 80% GPU
  - `nomic-embed-text:latest`: about 323MB, loaded as 100% GPU
- Other GPU consumers remain active: Whisper, SBVITS2, and WSL display/runtime processes
- Model filesystem: about 1,007GB total with 849GB free, so download storage is not the constraint
- Bot runtime: text-only, `num_ctx=4096`, one parallel request, at most two loaded Ollama models, Flash Attention enabled

The current 24MiB free figure means a third resident model cannot be added. A Gemma 4 trial must replace the loaded Qwen generation model while keeping the embedding model; merely downloading another model is harmless to VRAM, but loading it concurrently is not.

## Runtime trial on the twitchRaid sub-PC

A controlled trial was run from 21:52 to 22:05 JST while Twitch Helix reported the channel offline. The trial called the shipped mention-chat and Raid greeting generation functions directly with synthetic inputs. It did not send Twitch chat, post to Discord, or write mention-chat / mem0 memory.

- Downloaded model: `gemma4:e4b-it-qat`, Ollama ID `ee6656371218`, 6.1GB package
- Loaded model reported by `/api/ps`:
  - parameter size: 7.5B
  - quantization: Q4_0
  - resident size: 2,980,136,877 bytes
  - VRAM size: 2,980,136,877 bytes (100% GPU)
  - context: 4096
- With `nomic-embed-text:latest` also loaded:
  - both models remained resident after a new Gemma generation
  - GPU memory: 8,192MiB total, 6,192MiB used, 1,798MiB free
  - the post-embed Gemma verification completed in 694ms with a 548ms load duration, so it was not a full cold reload
- Cold one-token probe:
  - Gemma: 27.703s wall time
  - Qwen: 17.303s wall time
  - Ollama's Gemma duration fields summed to slightly more than wall time, so the cold breakdown is directional rather than an exact additive decomposition
- Warm mention-chat generation, eight identical scenarios:
  - Gemma average Ollama total: 1.755s; average generation speed: 52.32 tokens/s
  - Qwen average Ollama total: 2.753s; average generation speed: 26.69 tokens/s
  - Gemma reduced average model time by 36.3% and generated at 1.96x Qwen's speed
- Warm Raid greeting generation, two identical runs:
  - Gemma average Ollama total: 2.968s
  - Qwen average Ollama total: 5.065s
  - Gemma reduced average model time by 41.4%

An independent contract-based review scored the final replies 15/20 for Gemma and 6/20 for Qwen. Gemma correctly used the supplied April 2, 2026 search fact and preserved the Raid URL, while Qwen rejected the supplied search fact and produced a malformed extra Raid URL. Gemma still failed a critical no-fabrication case by inventing the stream's next plan, and both Gemma Raid samples added unsupported interpretation about the streamer's experience or likely reactions. Performance and hardware fit therefore passed, but the initial recommendation was to hold the production switch until this quality risk was accepted or mitigated.

After the trial, the shipped preload / representative-prime / embedding-prewarm path restored `qwen3.5:9b` and `nomic-embed-text:latest`. Gemma was stopped but kept downloaded for later evaluation. The existing `npm run perf:sub-ai-services` assertion passed after restoration:

- Qwen generate: 20 samples, 526.58ms average, 582.38ms p95
- nomic embed: 20 samples, 31.27ms average, 32.48ms p95, 768 dimensions
- mem0 search: 20 samples, 35.51ms average, 38.18ms p95
- SearXNG: 20 samples, 187.32ms average, 372.82ms p95
- all target services: 1/1, restart count zero, evaluator error count zero
- final Twitch Helix state: offline, zero live streams
- final effective generation models: `qwen3.5:9b` for mention chat and Raid, context 4096

Three broad log-pattern matches in Ollama were reviewed. All were `level=INFO` scheduler messages saying mmap was disabled under host-memory pressure; the naive case-insensitive `OOM` pattern had matched the substring in `headroom`. There was no actual error, OOM, CUDA failure, or service restart.

## Production cutover

The user explicitly selected Gemma after reviewing the performance and quality findings. The production cutover completed at 22:21 JST.

- Dokploy persistent application env and the live Bot Swarm service now set `CHAT_AI_MODEL`, `OLLAMA_MODEL`, and `OLLAMA_SHOUTOUT_MODEL` to `gemma4:e4b-it-qat`.
- The SUB AI Services persistent Compose and live mem0 service set `MEM0_LLM_MODEL=gemma4:e4b-it-qat`; `MEM0_EMBEDDER_MODEL=nomic-embed-text:latest` and `MEM0_INFER_DEFAULT=false` remain unchanged.
- Pre-change Dokploy and Swarm specifications were saved under `/home/mlove/dokploy/backups/twitchraid/gemma4-switch-20260717T221730Z` with directory mode 700 and file mode 600.
- The Bot kept update and rollback order `stop-first`. mem0 kept update `start-first` and rollback `stop-first`.
- Startup prewarm completed in 13.873s for Gemma, 2.071s for nomic, and 181ms for the read-only mem0 search.
- The final resident set was Gemma plus nomic only. Qwen stayed downloaded for rollback but was not loaded.
- A production-path, no-send, no-write canary reproduced the known unsupported stream-stage and Raid-impression fabrication. The switch remains active by explicit user choice; prompt and regression-test hardening remains follow-up work.
- Four post-cutover 20-sample evaluator runs passed with all six services at 1/1, stable tasks, zero restarts, and zero error logs. Generation p95 ranged from 751.51ms to 770.54ms. The evaluator now fails closed unless all three Bot generation-model settings and the mem0 LLM/embed/infer service settings match the production contract.

## Conclusions for twitchRaid sub-PC adoption

1. **Recommended trial candidate: `gemma4:e4b-it-qat`.** Its official Ollama package is 6.1GB, slightly smaller than the currently loaded Qwen package, and Google estimates 4.5GB to load E4B Q4_0 before runtime-specific differences. It should be tested as a Qwen replacement, not as an additional resident model.
2. **Safest memory candidate: `gemma4:e2b-it-qat`.** It has substantially more headroom, but its smaller effective model means answer quality must be compared against the current `qwen3.5:9b` before production use.
3. **Do not use the unqualified `gemma4` tag on this host.** It resolves to the much larger E4B package (9.6GB); use the explicit `e4b-it-qat` tag for the trial.
4. **12B is loadable only with meaningful CPU offload and is not recommended for this production GPU-sharing setup.** Google explicitly targets 16GB-class systems for the full local 12B experience, while this host has only 8GB VRAM and already offloads part of the smaller Qwen model.
5. **26B A4B and 31B are not practical locally on this host.** Their Q4_0 load estimates alone are 14.4GB and 17.5GB, before the other running services and context cache.
6. Hardware and Ollama-version compatibility are confirmed for E4B QAT at the production context of 4096, and it is now the active production model by explicit user choice. It is materially faster and leaves more GPU headroom than Qwen; the known stream-plan and Raid-detail fabrication remains an accepted short-term risk pending prompt hardening.

## Remaining uncertainties

- Google’s table and the Ollama tags list are estimates for different layers of the stack, so neither should be treated as a hard runtime guarantee; the runtime measurements above are specific to this host and context 4096.
- The two Raid samples establish a strong performance direction but are too few for a stable latency percentile.
- Prompt / response-contract hardening is still needed for unknown stream state and unsupported Raid details, followed by a longer mixed Whisper / SBVITS2 load window. Keep Qwen downloaded as the rollback model.
