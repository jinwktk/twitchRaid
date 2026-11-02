import importlib.util
import http.client
import json
import socket
import sys
import threading
import time
import types
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import pytest
import subprocess
from datetime import datetime, timezone
from pathlib import Path


MODULE_PATH = (
    Path(__file__).resolve().parents[1] / "ops" / "video-analysis" / "video_analysis.py"
)
SPEC = importlib.util.spec_from_file_location("video_analysis", MODULE_PATH)
video_analysis = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
sys.modules[SPEC.name] = video_analysis
SPEC.loader.exec_module(video_analysis)


def test_hls_window_starts_at_requested_instant_and_covers_full_30_seconds():
    playlist = """#EXTM3U
#EXT-X-VERSION:3
#EXT-X-MEDIA-SEQUENCE:100
#EXT-X-PROGRAM-DATE-TIME:2026-11-03T12:00:00.000Z
#EXTINF:10.000,
https://video-weaver.tyo01.hls.ttvnw.net/segment-100.ts
#EXT-X-PROGRAM-DATE-TIME:2026-11-03T12:00:10.000Z
#EXTINF:10.000,
https://video-weaver.tyo01.hls.ttvnw.net/segment-101.ts
#EXT-X-PROGRAM-DATE-TIME:2026-11-03T12:00:20.000Z
#EXTINF:10.000,
https://video-weaver.tyo01.hls.ttvnw.net/segment-102.ts
#EXT-X-PROGRAM-DATE-TIME:2026-11-03T12:00:30.000Z
#EXTINF:10.000,
https://video-weaver.tyo01.hls.ttvnw.net/segment-103.ts
"""

    segments = video_analysis.parse_media_playlist(
        playlist,
        "https://video-weaver.tyo01.hls.ttvnw.net/live/index.m3u8",
    )
    window = video_analysis.select_exact_window(
        segments,
        requested_at=datetime(2026, 11, 3, 12, 0, 5, tzinfo=timezone.utc),
        duration_seconds=30,
    )

    assert [segment.sequence for segment in window.segments] == [100, 101, 102, 103]
    assert window.trim_offset_seconds == 5.0
    assert window.coverage_seconds == 35.0


def test_hls_window_rejects_cumulative_program_time_drift_and_overlap():
    start = datetime(2026, 11, 3, 12, 0, 0, tzinfo=timezone.utc)
    segments = [
        video_analysis.HlsSegment(
            sequence=100 + index,
            start=start + video_analysis.timedelta(seconds=index * 1.5),
            duration_seconds=2.0,
            url=f"https://video-weaver.tyo01.hls.ttvnw.net/{100 + index}.ts",
        )
        for index in range(22)
    ]

    with pytest.raises(video_analysis.VideoUnavailable, match="segment_time_drift"):
        video_analysis.select_exact_window(
            segments,
            requested_at=start,
            duration_seconds=30,
        )


def test_api_request_contract_accepts_only_the_allowed_channel_and_30_seconds():
    request = video_analysis.parse_analyze_request(
        json.dumps(
            {
                "requestId": "mention-123",
                "channel": "rukalun",
                "streamId": "316500000001",
                "requestedAt": "2026-11-03T12:00:05.000Z",
                "durationSeconds": 30,
                "question": "今の場面はどうなってる？",
            }
        ).encode("utf-8"),
        allowed_channel="rukalun",
    )

    assert request.request_id == "mention-123"
    assert request.channel == "rukalun"
    assert request.requested_at == datetime(2026, 11, 3, 12, 0, 5, tzinfo=timezone.utc)
    assert request.duration_seconds == 30


@pytest.mark.parametrize(
    ("playlist", "reason"),
    [
        (
            "#EXTM3U\n#EXTINF:10,\nhttps://video-weaver.tyo01.hls.ttvnw.net/a.ts\n",
            "missing_program_date_time",
        ),
    ],
)
def test_hls_playlist_fails_closed_without_safe_timestamps(playlist, reason):
    with pytest.raises(video_analysis.VideoUnavailable, match=reason):
        video_analysis.parse_media_playlist(
            playlist,
            "https://video-weaver.tyo01.hls.ttvnw.net/live/index.m3u8",
        )


def test_past_ad_range_is_allowed_but_selected_ad_range_is_rejected():
    playlist = """#EXTM3U
#EXT-X-MEDIA-SEQUENCE:100
#EXT-X-DATERANGE:ID="stitched-ad-old",CLASS="twitch-stitched-ad",START-DATE="2026-11-03T11:59:00Z",DURATION=20
#EXT-X-PROGRAM-DATE-TIME:2026-11-03T12:00:00Z
#EXTINF:10,
https://video-weaver.tyo01.hls.ttvnw.net/100.ts
#EXT-X-DATERANGE:ID="stitched-ad-current",CLASS="twitch-stitched-ad",START-DATE="2026-11-03T12:00:10Z",DURATION=10
#EXT-X-PROGRAM-DATE-TIME:2026-11-03T12:00:10Z
#EXTINF:10,
https://video-weaver.tyo01.hls.ttvnw.net/101.ts
#EXT-X-PROGRAM-DATE-TIME:2026-11-03T12:00:20Z
#EXTINF:10,
https://video-weaver.tyo01.hls.ttvnw.net/102.ts
#EXT-X-PROGRAM-DATE-TIME:2026-11-03T12:00:30Z
#EXTINF:10,
https://video-weaver.tyo01.hls.ttvnw.net/103.ts
"""
    segments = video_analysis.parse_media_playlist(
        playlist,
        "https://video-weaver.tyo01.hls.ttvnw.net/live/index.m3u8",
    )

    safe = video_analysis.select_exact_window(
        segments,
        requested_at=datetime(2026, 11, 3, 12, 0, 0, tzinfo=timezone.utc),
        duration_seconds=10,
    )
    assert [segment.sequence for segment in safe.segments] == [100]

    with pytest.raises(video_analysis.VideoUnavailable, match="ad_segment"):
        video_analysis.select_exact_window(
            segments,
            requested_at=datetime(2026, 11, 3, 12, 0, 5, tzinfo=timezone.utc),
            duration_seconds=30,
        )


def test_normal_twitch_daterange_with_ad_characters_in_opaque_id_is_not_an_ad():
    playlist = """#EXTM3U
#EXT-X-MEDIA-SEQUENCE:100
#EXT-X-DATERANGE:ID="opaque-ad-value",CLASS="twitch-session",START-DATE="2026-11-03T12:00:00Z"
#EXT-X-PROGRAM-DATE-TIME:2026-11-03T12:00:00Z
#EXTINF:10,
https://video-weaver.tyo01.hls.ttvnw.net/100.ts
"""

    segments = video_analysis.parse_media_playlist(
        playlist,
        "https://video-weaver.tyo01.hls.ttvnw.net/live/index.m3u8",
    )

    assert len(segments) == 1
    assert segments[0].is_ad is False


@pytest.mark.parametrize(
    ("marker", "reason"),
    [
        ('#EXT-X-KEY:METHOD=AES-128,URI="https://key.invalid/key"', "encrypted_stream"),
        ("#EXT-X-DISCONTINUITY", "stream_discontinuity"),
    ],
)
def test_selected_encrypted_or_discontinuous_segment_is_rejected(marker, reason):
    playlist = f"""#EXTM3U
#EXT-X-MEDIA-SEQUENCE:100
{marker}
#EXT-X-PROGRAM-DATE-TIME:2026-11-03T12:00:00Z
#EXTINF:10,
https://video-weaver.tyo01.hls.ttvnw.net/100.ts
"""
    segments = video_analysis.parse_media_playlist(
        playlist,
        "https://video-weaver.tyo01.hls.ttvnw.net/live/index.m3u8",
    )

    with pytest.raises(video_analysis.VideoUnavailable, match=reason):
        video_analysis.select_exact_window(
            segments,
            requested_at=datetime(2026, 11, 3, 12, 0, 0, tzinfo=timezone.utc),
            duration_seconds=5,
        )


def test_cdn_url_rejects_non_https_and_non_twitch_hosts():
    for url in (
        "http://video-weaver.tyo01.hls.ttvnw.net/live/index.m3u8",
        "https://example.com/live/index.m3u8",
        "https://ttvnw.net.evil.example/live/index.m3u8",
        "file:///tmp/video.ts",
    ):
        with pytest.raises(video_analysis.VideoUnavailable, match="unsafe_media_url"):
            video_analysis.validate_twitch_cdn_url(url)


def test_all_30_timestamped_frames_are_sent_in_six_contiguous_vision_batches(tmp_path):
    frames = []
    for second in range(30):
        path = tmp_path / f"frame-{second:02d}.jpg"
        path.write_bytes(f"jpeg-{second}".encode())
        frames.append(video_analysis.Frame(path=path, pts_seconds=second + 0.5))
    payloads = []

    def fake_ollama(payload):
        payloads.append(payload)
        if payload.get("images"):
            return {
                "response": json.dumps(
                    {
                        "start": f"batch-{len(payloads)} start",
                        "changes": ["変化"],
                        "end": "end",
                        "uncertain": [],
                    },
                    ensure_ascii=False,
                ),
                "done": True,
                "done_reason": "stop",
                "prompt_eval_count": 800,
                "eval_count": 30,
            }
        return {
            "response": "30秒全体では、画面内の人物が移動していました。",
            "done": True,
            "done_reason": "stop",
            "prompt_eval_count": 1200,
            "eval_count": 40,
        }

    analysis = video_analysis.analyze_frames_with_ollama(
        frames,
        transcript="音声の文字起こし",
        question="何が起きた？",
        ollama_generate=fake_ollama,
        model="gemma4:e4b-it-qat",
        context_length=4096,
    )

    vision_payloads = payloads[:6]
    assert [len(payload["images"]) for payload in vision_payloads] == [5] * 6
    assert sum(len(payload["images"]) for payload in vision_payloads) == 30
    assert "00:00.500" in vision_payloads[0]["prompt"]
    assert "00:29.500" in vision_payloads[-1]["prompt"]
    assert all(payload["options"]["num_predict"] == 384 for payload in vision_payloads)
    assert all(payload["format"]["type"] == "object" for payload in vision_payloads)
    assert all(
        payload["format"]["additionalProperties"] is False
        for payload in vision_payloads
    )
    assert all(
        payload["format"]["properties"]["changes"]["maxItems"] == 3
        for payload in vision_payloads
    )
    for payload in vision_payloads:
        prompt = payload["prompt"]
        assert "小さな文字、数値、固有名詞を推測して出力しない" in prompt
        assert "配信アバター、コメント欄、配信オーバーレイ" in prompt
        assert "ゲーム進行の根拠にしない" in prompt
        assert "撮影区間内の相対時刻" in prompt
        assert "画面内に表示された時刻ではありません" in prompt
        assert "ロビーや実戦は十分な視覚根拠がある場合だけ" in prompt
    assert "300〜500文字" in payloads[-1]["prompt"]
    final_prompt = payloads[-1]["prompt"]
    assert "小さな文字、数値、固有名詞を推測して出力しない" in final_prompt
    assert "配信アバター、コメント欄、配信オーバーレイ" in final_prompt
    assert "ゲーム進行の根拠にしない" in final_prompt
    assert "撮影区間内の相対時刻" in final_prompt
    assert "画面内に表示された時刻ではありません" in final_prompt
    assert "ロビーや実戦は十分な視覚根拠がある場合だけ" in final_prompt
    assert all(payload["think"] is False for payload in payloads)
    assert all(payload["stream"] is False for payload in payloads)
    assert analysis.startswith("30秒全体では")


def test_vision_rejects_context_or_length_truncated_ollama_response(tmp_path):
    frames = []
    for second in range(30):
        path = tmp_path / f"frame-{second:02d}.jpg"
        path.write_bytes(b"jpeg")
        frames.append(video_analysis.Frame(path=path, pts_seconds=second + 0.5))

    with pytest.raises(video_analysis.VideoUnavailable, match="vision_truncated"):
        video_analysis.analyze_frames_with_ollama(
            frames,
            transcript="",
            question="何が起きた？",
            ollama_generate=lambda _payload: {
                "response": "途中まで",
                "done": True,
                "done_reason": "length",
                "prompt_eval_count": 3900,
                "eval_count": 196,
            },
            model="gemma4:e4b-it-qat",
            context_length=4096,
        )


def test_frame_pts_are_read_from_ffmpeg_showinfo_not_inferred_from_filenames(tmp_path):
    video_path = tmp_path / "window.mp4"
    video_path.write_bytes(b"mp4")

    def fake_run(args, **kwargs):
        output_pattern = Path(args[-1])
        for index in range(1, 31):
            Path(str(output_pattern).replace("%03d", f"{index:03d}")).write_bytes(
                b"jpg"
            )
        pts = [0.25 + index for index in range(30)]
        stderr = "\n".join(
            f"[Parsed_showinfo_2] n:{index} pts:{index} pts_time:{value:.3f}"
            for index, value in enumerate(pts)
        )
        return subprocess.CompletedProcess(args, 0, "", stderr)

    frames = video_analysis.extract_timestamped_frames(
        video_path,
        tmp_path,
        command_runner=fake_run,
    )

    assert len(frames) == 30
    assert frames[0].pts_seconds == 0.25
    assert frames[-1].pts_seconds == 29.25


def test_engine_removes_temporary_video_when_whisper_fails(tmp_path):
    work_root = tmp_path / "work"
    work_root.mkdir()

    def capture(_request, work_dir, _deadline):
        path = work_dir / "window.mp4"
        path.write_bytes(b"private-video")
        return path

    def decode(_video_path, work_dir, _deadline):
        audio = work_dir / "audio.wav"
        audio.write_bytes(b"wav")
        frames = []
        for second in range(30):
            path = work_dir / f"frame-{second:03d}.jpg"
            path.write_bytes(b"jpg")
            frames.append(video_analysis.Frame(path, second + 0.5))
        return frames, audio

    def transcribe(_audio_path, _request_id, _deadline):
        raise video_analysis.VideoUnavailable("whisper_unavailable")

    engine = video_analysis.VideoAnalysisEngine(
        temp_root=work_root,
        capture_window=capture,
        decode_media=decode,
        transcribe_audio=transcribe,
        analyze_vision=lambda *_args, **_kwargs: "unused",
    )
    request = video_analysis.AnalyzeRequest(
        request_id="mention-123",
        channel="rukalun",
        stream_id="316500000001",
        requested_at=datetime(2026, 11, 3, 12, 0, 5, tzinfo=timezone.utc),
        duration_seconds=30,
        question="何が起きた？",
    )

    with pytest.raises(video_analysis.VideoUnavailable, match="whisper_unavailable"):
        engine.analyze(request)

    assert list(work_root.iterdir()) == []


def test_engine_success_matches_bot_api_schema_and_iso_milliseconds(tmp_path):
    work_root = tmp_path / "work"
    work_root.mkdir()

    def capture(_request, work_dir, _deadline):
        path = work_dir / "window.mp4"
        path.write_bytes(b"mp4")
        return path

    def decode(_video_path, work_dir, _deadline):
        audio = work_dir / "audio.wav"
        audio.write_bytes(b"wav")
        frames = []
        for second in range(30):
            path = work_dir / f"frame-{second:03d}.jpg"
            path.write_bytes(b"jpg")
            frames.append(video_analysis.Frame(path, second + 0.5))
        return frames, audio

    engine = video_analysis.VideoAnalysisEngine(
        temp_root=work_root,
        capture_window=capture,
        decode_media=decode,
        transcribe_audio=lambda _path, _request_id, _deadline: "音声",
        analyze_vision=lambda _frames, _transcript, _question, _deadline: "映像解析",
    )
    request = video_analysis.AnalyzeRequest(
        request_id="mention-123",
        channel="rukalun",
        stream_id="316500000001",
        requested_at=datetime(2026, 11, 3, 12, 0, 5, tzinfo=timezone.utc),
        duration_seconds=30,
        question="何が起きた？",
    )

    result = engine.analyze(request)

    assert result["status"] == "ok"
    assert result["requestedAt"] == "2026-11-03T12:00:05.000Z"
    assert result["windowEnd"] == "2026-11-03T12:00:35.000Z"
    assert result["frameCount"] == 30
    assert result["analysis"] == "映像解析"
    assert result["transcript"] == "音声"
    assert set(result["timings"]) == {
        "captureMs",
        "decodeMs",
        "visionMs",
        "transcribeMs",
        "totalMs",
    }
    assert list(work_root.iterdir()) == []


def test_engine_shared_deadline_stops_before_starting_the_next_stage(tmp_path):
    clock = {"now": 0.0}
    decode_called = False

    def capture(_request, work_dir, _deadline):
        path = work_dir / "window.mp4"
        path.write_bytes(b"mp4")
        clock["now"] = 2.0
        return path

    def decode(_video_path, _work_dir, _deadline):
        nonlocal decode_called
        decode_called = True
        raise AssertionError("decode must not start after the shared deadline")

    engine = video_analysis.VideoAnalysisEngine(
        temp_root=tmp_path,
        capture_window=capture,
        decode_media=decode,
        transcribe_audio=lambda *_args: "",
        analyze_vision=lambda *_args: "",
        total_timeout_seconds=1.0,
        monotonic=lambda: clock["now"],
    )
    request = video_analysis.AnalyzeRequest(
        request_id="mention-123",
        channel="rukalun",
        stream_id="316500000001",
        requested_at=datetime(2026, 11, 3, 12, 0, 5, tzinfo=timezone.utc),
        duration_seconds=30,
        question="何が起きた？",
    )

    with pytest.raises(video_analysis.VideoUnavailable, match="total_timeout"):
        engine.analyze(request)

    assert decode_called is False


def test_engine_rechecks_shared_deadline_after_final_vision(tmp_path):
    clock = {"now": 0.0}

    def capture(_request, work_dir, _deadline):
        path = work_dir / "window.mp4"
        path.write_bytes(b"mp4")
        return path

    def decode(_video_path, work_dir, _deadline):
        audio = work_dir / "audio.wav"
        audio.write_bytes(b"wav")
        frames = []
        for second in range(30):
            path = work_dir / f"frame-{second:03d}.jpg"
            path.write_bytes(b"jpg")
            frames.append(video_analysis.Frame(path, second + 0.5))
        return frames, audio

    def vision(_frames, _transcript, _question, _deadline):
        clock["now"] = 2.0
        return "期限後の回答"

    engine = video_analysis.VideoAnalysisEngine(
        temp_root=tmp_path,
        capture_window=capture,
        decode_media=decode,
        transcribe_audio=lambda *_args: "音声",
        analyze_vision=vision,
        total_timeout_seconds=1.0,
        monotonic=lambda: clock["now"],
    )
    request = video_analysis.AnalyzeRequest(
        request_id="mention-123",
        channel="rukalun",
        stream_id="316500000001",
        requested_at=datetime(2026, 11, 3, 12, 0, 5, tzinfo=timezone.utc),
        duration_seconds=30,
        question="何が起きた？",
    )

    with pytest.raises(video_analysis.VideoUnavailable, match="total_timeout"):
        engine.analyze(request)


def test_streamlink_uses_360p30_prefix_variant_instead_of_worst():
    selected = video_analysis.select_streamlink_variant(
        {
            "audio_only": object(),
            "160p30": object(),
            "360p30": "expected-stream",
            "480p30": object(),
            "worst": object(),
        }
    )

    assert selected == "expected-stream"


def test_streamlink_resolution_returns_twitch_live_stream_id(monkeypatch):
    class FakeStream:
        def to_url(self):
            return "https://apn12.playlist.ttvnw.net/v1/playlist/signed.m3u8"

    class FakePlugin:
        def __init__(self, session, resolved_url):
            assert isinstance(session, FakeSession)
            assert resolved_url == "https://www.twitch.tv/rukalun"

        def streams(self):
            return {"360p30": FakeStream(), "worst": object()}

        def get_metadata(self):
            return {"id": "316500000001", "author": "rukalun"}

    class FakeSession:
        def __init__(self):
            self.options = {}

        def set_option(self, key, value):
            self.options[key] = value

        def resolve_url(self, url):
            return "twitch", FakePlugin, url

    monkeypatch.setitem(
        sys.modules, "streamlink", types.SimpleNamespace(Streamlink=FakeSession)
    )

    resolved = video_analysis.resolve_twitch_media_playlist_direct("rukalun")

    assert resolved.stream_id == "316500000001"
    assert resolved.playlist_url.startswith("https://apn12.playlist.ttvnw.net/")


def test_collect_hls_window_times_out_instead_of_using_later_video():
    playlist = """#EXTM3U
#EXT-X-MEDIA-SEQUENCE:100
#EXT-X-PROGRAM-DATE-TIME:2026-11-03T12:00:00Z
#EXTINF:2,
https://video-weaver.tyo01.hls.ttvnw.net/100.ts
"""
    clock = {"now": 0.0}

    with pytest.raises(video_analysis.VideoUnavailable, match="capture_timeout"):
        video_analysis.collect_hls_window(
            playlist_url="https://video-weaver.tyo01.hls.ttvnw.net/live/index.m3u8",
            requested_at=datetime(2026, 11, 3, 12, 0, 5, tzinfo=timezone.utc),
            duration_seconds=30,
            fetch_playlist=lambda _url: playlist,
            monotonic=lambda: clock["now"],
            sleep=lambda seconds: clock.__setitem__("now", clock["now"] + seconds),
            deadline_seconds=2,
        )


def test_same_hls_sequence_changing_url_is_rejected_as_stream_change():
    playlists = iter(
        [
            """#EXTM3U
#EXT-X-MEDIA-SEQUENCE:100
#EXT-X-PROGRAM-DATE-TIME:2026-11-03T12:00:00Z
#EXTINF:10,
https://video-weaver.tyo01.hls.ttvnw.net/first-100.ts
""",
            """#EXTM3U
#EXT-X-MEDIA-SEQUENCE:100
#EXT-X-PROGRAM-DATE-TIME:2026-11-03T12:00:00Z
#EXTINF:10,
https://video-weaver.tyo01.hls.ttvnw.net/replaced-100.ts
""",
        ]
    )
    clock = {"now": 0.0}

    with pytest.raises(video_analysis.VideoUnavailable, match="stream_changed"):
        video_analysis.collect_hls_window(
            playlist_url="https://video-weaver.tyo01.hls.ttvnw.net/live/index.m3u8",
            requested_at=datetime(2026, 11, 3, 12, 0, 5, tzinfo=timezone.utc),
            duration_seconds=30,
            fetch_playlist=lambda _url: next(playlists),
            monotonic=lambda: clock["now"],
            sleep=lambda seconds: clock.__setitem__("now", clock["now"] + seconds),
            deadline_seconds=2,
        )


def test_http_api_returns_health_and_bounded_unavailable_response():
    class StubEngine:
        def analyze(self, _request):
            raise video_analysis.VideoUnavailable("whisper_unavailable")

    handler = video_analysis.make_request_handler(
        engine=StubEngine(),
        allowed_channel="rukalun",
    )
    server = video_analysis.VideoAnalysisHttpServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        connection = http.client.HTTPConnection(
            "127.0.0.1", server.server_port, timeout=2
        )
        connection.request("GET", "/health")
        health = connection.getresponse()
        assert health.status == 200
        assert json.loads(health.read()) == {"status": "ok"}

        body = json.dumps(
            {
                "requestId": "mention-123",
                "channel": "rukalun",
                "streamId": "316500000001",
                "requestedAt": "2026-11-03T12:00:05Z",
                "durationSeconds": 30,
                "question": "何が起きた？",
            }
        )
        connection.request(
            "POST",
            "/v1/analyze-live",
            body=body,
            headers={"Content-Type": "application/json"},
        )
        response = connection.getresponse()
        assert response.status == 503
        assert json.loads(response.read()) == {
            "status": "unavailable",
            "reason": "whisper_unavailable",
            "requestId": "mention-123",
        }
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def test_failure_logs_exclude_question_urls_and_upstream_bodies(caplog):
    class StubEngine:
        def analyze(self, _request):
            raise video_analysis.VideoUnavailable("upstream_unavailable")

    secret_question = "https://example.invalid/?token=secret response-body-secret"
    body = json.dumps(
        {
            "requestId": "mention-safe-id",
            "channel": "rukalun",
            "streamId": "316500000001",
            "requestedAt": "2026-11-03T12:00:05Z",
            "durationSeconds": 30,
            "question": secret_question,
        }
    ).encode()

    status, payload = video_analysis.process_analyze_body(
        body,
        allowed_channel="rukalun",
        engine=StubEngine(),
    )

    assert status == 503
    assert payload["reason"] == "upstream_unavailable"
    assert "mention-safe-id" in caplog.text
    assert secret_question not in caplog.text
    assert "response-body-secret" not in caplog.text


def test_upstream_slow_dribble_cannot_exceed_absolute_deadline():
    class SlowHandler(BaseHTTPRequestHandler):
        def log_message(self, _format, *_args):
            return

        def do_POST(self):
            body = b'{"response":"ok"}'
            self.send_response(200)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            try:
                for byte in body:
                    self.wfile.write(bytes([byte]))
                    self.wfile.flush()
                    time.sleep(0.04)
            except OSError:
                pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), SlowHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    client = video_analysis.SafeHttpClient(timeout_seconds=1)
    started = time.monotonic()
    try:
        with pytest.raises(video_analysis.VideoUnavailable, match="upstream_timeout"):
            client.post_json(
                f"http://127.0.0.1:{server.server_port}/api/generate",
                {"probe": True},
                max_bytes=1024,
                timeout_seconds=0.10,
            )
        assert time.monotonic() - started < 0.40
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def test_ai_worker_receives_configured_90_second_idle_timeout(monkeypatch):
    captured = {}

    def fake_worker(action, payload, *, timeout_seconds):
        captured.update(
            action=action,
            payload=payload,
            timeout_seconds=timeout_seconds,
        )
        return {
            "ok": True,
            "data": video_analysis.base64.b64encode(b'{"response":"ok"}').decode(),
        }

    monkeypatch.setattr(video_analysis, "_run_isolated_worker", fake_worker)
    client = video_analysis.SafeHttpClient(timeout_seconds=90)

    client.post_json(
        "http://ollama:11434/api/generate",
        {"probe": True},
        max_bytes=1024,
        timeout_seconds=90,
    )

    assert captured["action"] == "http"
    assert captured["timeout_seconds"] == 90
    assert captured["payload"]["socketTimeoutSeconds"] == 90


def test_http_server_caps_active_threads_before_reading_request_body():
    class StubEngine:
        def analyze(self, _request):
            raise AssertionError("not reached")

    handler = video_analysis.make_request_handler(
        engine=StubEngine(),
        allowed_channel="rukalun",
    )
    server = video_analysis.VideoAnalysisHttpServer(
        ("127.0.0.1", 0),
        handler,
        max_active_requests=1,
        socket_timeout_seconds=0.5,
    )
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    blocker = socket.create_connection(("127.0.0.1", server.server_port), timeout=2)
    blocker.sendall(b"POST /v1/analyze-live HTTP/1.1\r\nHost: localhost\r\n")
    time.sleep(0.05)
    try:
        connection = http.client.HTTPConnection(
            "127.0.0.1", server.server_port, timeout=2
        )
        connection.request("GET", "/health")
        response = connection.getresponse()
        assert response.status == 503
        assert json.loads(response.read())["reason"] == "server_busy"
    finally:
        blocker.close()
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def test_http_body_slow_dribble_is_cut_off_by_absolute_read_timer():
    class StubEngine:
        def analyze(self, _request):
            raise AssertionError("not reached")

    handler = video_analysis.make_request_handler(
        engine=StubEngine(),
        allowed_channel="rukalun",
        request_read_timeout_seconds=0.10,
    )
    server = video_analysis.VideoAnalysisHttpServer(
        ("127.0.0.1", 0),
        handler,
        max_active_requests=1,
        socket_timeout_seconds=1.0,
    )
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    client = socket.create_connection(("127.0.0.1", server.server_port), timeout=2)
    client.sendall(
        b"POST /v1/analyze-live HTTP/1.1\r\n"
        b"Host: localhost\r\nContent-Length: 12\r\n\r\n"
    )
    started = time.monotonic()
    try:
        for _ in range(12):
            try:
                client.sendall(b"x")
            except OSError:
                break
            time.sleep(0.04)
        assert time.monotonic() - started < 0.35
        time.sleep(0.05)

        connection = http.client.HTTPConnection(
            "127.0.0.1", server.server_port, timeout=2
        )
        connection.request("GET", "/health")
        response = connection.getresponse()
        assert response.status == 200
    finally:
        client.close()
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)
