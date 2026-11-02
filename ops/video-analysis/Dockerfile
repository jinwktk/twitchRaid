FROM python:3.12.12-slim-bookworm@sha256:593bd06efe90efa80dc4eee3948be7c0fde4134606dd40d8dd8dbcade98e669c

ARG VCS_REF=unknown
LABEL org.opencontainers.image.revision=${VCS_REF}

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    VIDEO_TEMP_ROOT=/tmp/video-analysis

RUN apt-get update \
    && apt-get install --no-install-recommends -y ca-certificates ffmpeg \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 10001 --create-home videoanalysis \
    && mkdir -p /app /tmp/video-analysis \
    && chown -R videoanalysis:videoanalysis /app /tmp/video-analysis

WORKDIR /app
COPY requirements.txt ./requirements.txt
RUN pip install --no-cache-dir --requirement requirements.txt

COPY video_analysis.py ./video_analysis.py
USER videoanalysis

EXPOSE 8090
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD ["python", "-c", "import json,urllib.request; response=urllib.request.urlopen('http://127.0.0.1:8090/health',timeout=2); data=json.load(response); raise SystemExit(0 if response.status==200 and data.get('status')=='ok' else 1)"]
CMD ["python", "/app/video_analysis.py"]
