package mediaprobe

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

type S3Store struct {
	client *minio.Client
}

func NewS3Store(endpoint, accessKey, secretKey, proxyURL string) (*S3Store, error) {
	parsed, err := url.Parse(strings.TrimSpace(endpoint))
	if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return nil, errors.New("object storage endpoint must be an absolute HTTP or HTTPS URL")
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	if strings.TrimSpace(proxyURL) != "" {
		proxy, err := url.Parse(proxyURL)
		if err != nil || proxy.Host == "" || (proxy.Scheme != "http" && proxy.Scheme != "https") {
			return nil, errors.New("object storage proxy URL is invalid")
		}
		transport.Proxy = http.ProxyURL(proxy)
	}
	client, err := minio.New(parsed.Host, &minio.Options{
		Creds:     credentials.NewStaticV4(accessKey, secretKey, ""),
		Secure:    parsed.Scheme == "https",
		Transport: transport,
	})
	if err != nil {
		return nil, fmt.Errorf("create media object storage client: %w", err)
	}
	// minio-go rewrites Amazon endpoints to s3.dualstack.* by default; the
	// egress proxy allowlists only the configured host, so keep that host.
	client.SetS3EnableDualstack(false)
	return &S3Store{client: client}, nil
}

func (store *S3Store) Head(ctx context.Context, bucket, key string) (Locator, error) {
	info, err := store.client.StatObject(ctx, bucket, key, minio.StatObjectOptions{})
	if err != nil {
		return Locator{}, classifyStorageError(err)
	}
	if info.IsDeleteMarker || strings.TrimSpace(info.VersionID) == "" || strings.TrimSpace(info.ETag) == "" || info.Size < 0 {
		return Locator{}, Failure{Code: FailureMediaProbe}
	}
	return Locator{
		Bucket:        bucket,
		Key:           key,
		VersionID:     info.VersionID,
		ETag:          info.ETag,
		ContentLength: info.Size,
	}, nil
}

func (store *S3Store) OpenVersion(ctx context.Context, locator Locator) (io.ReadCloser, error) {
	if locator.Bucket == "" || locator.Key == "" || locator.VersionID == "" {
		return nil, Failure{Code: FailureMediaProbe}
	}
	object, err := store.client.GetObject(ctx, locator.Bucket, locator.Key, minio.GetObjectOptions{VersionID: locator.VersionID})
	if err != nil {
		return nil, classifyStorageError(err)
	}
	info, err := object.Stat()
	if err != nil {
		object.Close()
		return nil, classifyStorageError(err)
	}
	if info.IsDeleteMarker || info.VersionID != locator.VersionID || info.ETag != locator.ETag || info.Size != locator.ContentLength {
		object.Close()
		return nil, Failure{Code: FailureMediaProbe}
	}
	return object, nil
}

func classifyStorageError(err error) error {
	var response minio.ErrorResponse
	if errors.As(err, &response) {
		switch {
		case response.Code == "NoSuchKey" || response.Code == "NoSuchObject" || response.Code == "NoSuchVersion":
			return Failure{Code: FailureMediaProbe}
		case response.Code == "SlowDown" || response.StatusCode == http.StatusTooManyRequests || response.StatusCode >= http.StatusInternalServerError:
			return Failure{Code: FailureMediaProbeStorageTemporary, Technical: true}
		default:
			return Failure{Code: FailureMediaProbe}
		}
	}
	var urlErr *url.Error
	if errors.As(err, &urlErr) || errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
		return Failure{Code: FailureMediaProbeStorageTemporary, Technical: true}
	}
	var netErr interface{ Timeout() bool }
	if errors.As(err, &netErr) && netErr.Timeout() {
		return Failure{Code: FailureMediaProbeStorageTemporary, Technical: true}
	}
	return Failure{Code: FailureMediaProbe}
}

var _ ObjectStore = (*S3Store)(nil)
