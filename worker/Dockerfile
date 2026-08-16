FROM golang:1.26.2-alpine AS build
WORKDIR /src/worker
COPY worker/go.mod worker/go.sum ./
RUN go mod download
COPY worker ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o /out/ai-worker ./cmd/ai-worker

FROM gcr.io/distroless/static-debian12:nonroot
WORKDIR /app
COPY --from=build /out/ai-worker /app/ai-worker
COPY app/src/database/migrations /app/migrations
USER 65532:65532
EXPOSE 3403
ENTRYPOINT ["/app/ai-worker"]
