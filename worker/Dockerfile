FROM --platform=linux/amd64 golang:1.26.2-alpine AS build
WORKDIR /src/worker
COPY worker/go.mod worker/go.sum ./
RUN go mod download
COPY worker ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o /out/ai-worker ./cmd/ai-worker
RUN CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o /out/media-probe-worker ./cmd/media-probe-worker

FROM --platform=linux/amd64 gcr.io/distroless/static-debian12:nonroot AS ai-worker
WORKDIR /app
COPY --from=build /out/ai-worker /app/ai-worker
COPY app/src/database/migrations /app/migrations
USER 65532:65532
EXPOSE 3403
ENTRYPOINT ["/app/ai-worker"]

# BtbN publishes a reproducible, statically packaged FFmpeg build. The archive
# checksum is the supply-chain pin; the runtime image carries ffprobe and, for
# derived audio (ADR-0032 D3), ffmpeg from the very same archive.
# worker/scripts/install-media-tools.sh reads these ARG literals so CI tests the
# same artifact; keep each value literal on one line. BtbN deletes daily
# autobuilds after ~2 weeks, so FFPROBE_RELEASE must be a month-end build.
FROM --platform=linux/amd64 debian:bookworm-slim@sha256:5ae3c39ebd15e229dcedd5cee596b2497182493d41ff162e824ba13fc1b2b867 AS media-probe-artifact
ARG FFPROBE_VERSION=8.1.3-27-g8dca1586f4
ARG FFPROBE_BUILD_VERSION=8.1.3-27-g8dca1586f4-20261031
ARG FFPROBE_RELEASE=autobuild-2026-10-31-12-59
ARG FFPROBE_ASSET=ffmpeg-n8.1.3-27-g8dca1586f4-linux64-gpl-8.1.tar.xz
ARG FFPROBE_URL=https://github.com/BtbN/FFmpeg-Builds/releases/download/${FFPROBE_RELEASE}/${FFPROBE_ASSET}
ARG FFPROBE_SHA256=41e9c565594c390622cf968d82fa4135d9e9a11d06c1515644288cbc844e3380
RUN apt-get update \
    && apt-get install --no-install-recommends --yes ca-certificates curl xz-utils \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /tmp/ffprobe
RUN curl --fail --location --silent --show-error --retry 3 --connect-timeout 10 --max-time 180 \
      "${FFPROBE_URL}" --output ffmpeg.tar.xz \
    && printf '%s  %s\n' "${FFPROBE_SHA256}" ffmpeg.tar.xz | sha256sum --check --status \
    && tar --extract --xz --file ffmpeg.tar.xz --strip-components=2 \
      --directory /usr/local/bin \
      "ffmpeg-n${FFPROBE_VERSION}-linux64-gpl-8.1/bin/ffprobe" \
      "ffmpeg-n${FFPROBE_VERSION}-linux64-gpl-8.1/bin/ffmpeg" \
    && ffprobe_version="$(/usr/local/bin/ffprobe -version | awk 'NR == 1 { print $3; exit }')" \
    && ffprobe_version="${ffprobe_version#n}" \
    && test "${ffprobe_version}" = "${FFPROBE_BUILD_VERSION}" \
    && ffmpeg_version="$(/usr/local/bin/ffmpeg -version | awk 'NR == 1 { print $3; exit }')" \
    && ffmpeg_version="${ffmpeg_version#n}" \
    && test "${ffmpeg_version}" = "${FFPROBE_BUILD_VERSION}" \
    && rm -rf /tmp/ffprobe

FROM --platform=linux/amd64 gcr.io/distroless/base-debian12:nonroot@sha256:5883c320d81f76c764e114c9ab14054f037bb040907816fc9028d80d9602a7c3 AS media-probe
WORKDIR /app
COPY --from=build /out/media-probe-worker /app/media-probe-worker
COPY --from=media-probe-artifact /usr/local/bin/ffprobe /usr/local/bin/ffprobe
COPY --from=media-probe-artifact /usr/local/bin/ffmpeg /usr/local/bin/ffmpeg
# The pinned BtbN binaries (ffprobe and ffmpeg link the same libraries) need
# libgcc_s, which is not included in the distroless base image by default.
COPY --from=media-probe-artifact /lib/x86_64-linux-gnu/libgcc_s.so.1 /lib/x86_64-linux-gnu/libgcc_s.so.1
ENV MEDIA_PROBE_FFPROBE_PATH=/usr/local/bin/ffprobe \
    MEDIA_PROBE_FFPROBE_VERSION=8.1.3-27-g8dca1586f4-20261031 \
    MEDIA_PROBE_FFMPEG_PATH=/usr/local/bin/ffmpeg \
    MEDIA_PROBE_FFMPEG_VERSION=8.1.3-27-g8dca1586f4-20261031 \
    MEDIA_PROBE_TEMP_DIR=/tmp/media-probe
USER 65532:65532
EXPOSE 3404
ENTRYPOINT ["/app/media-probe-worker"]

# Keep the historical default build target for callers that omit --target.
FROM ai-worker AS default
