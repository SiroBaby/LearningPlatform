package mediaprobe

import (
	"math"
	"math/big"
	"strconv"
	"strings"
)

const (
	maxMediaDurationSec = 7200
	maxVideoEdgePixels  = 1920
	maxVideoPixels      = 2073600
	maxFrameRate        = 30
)

// ValidateMetadata applies the browser-compatible MVP media contract to the
// output of ffprobe. It intentionally does not trust file names or MIME types.
func ValidateMetadata(metadata Metadata, contentLength int64) (ProbeResult, error) {
	duration, err := parseDuration(metadata.Format.Duration)
	if err != nil || duration <= 0 || duration > maxMediaDurationSec {
		return ProbeResult{}, Failure{Code: FailureMediaProbe}
	}
	if hasProtectedMedia(metadata) {
		return ProbeResult{}, Failure{Code: FailureUnsupportedContainer}
	}

	format := formatTokens(metadata.Format.Name)
	if format["mp3"] {
		if contentLength < 0 || contentLength > 300*1024*1024 {
			return ProbeResult{}, Failure{Code: FailureObjectTooLarge}
		}
		if err := validateMP3(metadata.Streams); err != nil {
			return ProbeResult{}, err
		}
		return ProbeResult{DurationSec: duration, Locator: Locator{ContentLength: contentLength}}, nil
	}
	if format["mp4"] {
		if contentLength < 0 || contentLength > 500*1024*1024 {
			return ProbeResult{}, Failure{Code: FailureObjectTooLarge}
		}
		if err := validateMP4(metadata.Streams); err != nil {
			return ProbeResult{}, err
		}
		return ProbeResult{DurationSec: duration, Locator: Locator{ContentLength: contentLength}}, nil
	}
	return ProbeResult{}, Failure{Code: FailureUnsupportedContainer}
}

func parseDuration(raw string) (int, error) {
	seconds, err := strconv.ParseFloat(strings.TrimSpace(raw), 64)
	if err != nil || math.IsNaN(seconds) || math.IsInf(seconds, 0) {
		return 0, strconv.ErrSyntax
	}
	return int(math.Ceil(seconds)), nil
}

func formatTokens(raw string) map[string]bool {
	result := make(map[string]bool)
	for _, token := range strings.Split(strings.ToLower(raw), ",") {
		result[strings.TrimSpace(token)] = true
	}
	return result
}

func validateMP3(streams []StreamMetadata) error {
	if len(streams) != 1 || streams[0].CodecType != "audio" {
		return Failure{Code: FailureUnsupportedAudioCodec}
	}
	stream := streams[0]
	if stream.CodecName != "mp3" || (stream.Channels != 1 && stream.Channels != 2) {
		return Failure{Code: FailureUnsupportedAudioCodec}
	}
	return nil
}

func validateMP4(streams []StreamMetadata) error {
	if len(streams) == 0 {
		return Failure{Code: FailureAudioTrackRequired}
	}
	video, audio := make([]StreamMetadata, 0, 1), make([]StreamMetadata, 0, 1)
	for _, stream := range streams {
		switch stream.CodecType {
		case "video":
			video = append(video, stream)
		case "audio":
			audio = append(audio, stream)
		default:
			return Failure{Code: FailureUnsupportedContainer}
		}
	}
	if len(video) != 1 {
		return Failure{Code: FailureUnsupportedVideoCodec}
	}
	if len(audio) != 1 {
		return Failure{Code: FailureAudioTrackRequired}
	}
	if err := validateVideoStream(video[0]); err != nil {
		return err
	}
	if err := validateAudioStream(audio[0]); err != nil {
		return err
	}
	return nil
}

func validateVideoStream(stream StreamMetadata) error {
	if stream.CodecName != "h264" ||
		(stream.Profile != "Baseline" && stream.Profile != "Main" && stream.Profile != "High") ||
		stream.PixelFormat != "yuv420p" {
		return Failure{Code: FailureUnsupportedVideoCodec}
	}
	if stream.CodedWidth <= 0 || stream.CodedHeight <= 0 ||
		max(stream.CodedWidth, stream.CodedHeight) > maxVideoEdgePixels ||
		stream.CodedWidth > maxVideoPixels/stream.CodedHeight {
		return Failure{Code: FailureUnsupportedVideoCodec}
	}
	if !validFrameRate(stream.AverageRate) {
		return Failure{Code: FailureUnsupportedVideoCodec}
	}
	return nil
}

func validateAudioStream(stream StreamMetadata) error {
	if stream.CodecName != "aac" || stream.Profile != "LC" ||
		(stream.Channels != 1 && stream.Channels != 2) {
		return Failure{Code: FailureUnsupportedAudioCodec}
	}
	if !stream.IsDefault {
		return Failure{Code: FailureAudioTrackRequired}
	}
	return nil
}

func validFrameRate(raw string) bool {
	parts := strings.Split(strings.TrimSpace(raw), "/")
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return false
	}
	numerator, numeratorOK := new(big.Int).SetString(parts[0], 10)
	denominator, denominatorOK := new(big.Int).SetString(parts[1], 10)
	if !numeratorOK || !denominatorOK || numerator.Sign() <= 0 || denominator.Sign() <= 0 {
		return false
	}
	return new(big.Rat).SetFrac(numerator, denominator).Cmp(big.NewRat(maxFrameRate, 1)) <= 0
}

func hasProtectedMedia(metadata Metadata) bool {
	for key, value := range metadata.Format.Tags {
		if isProtectionTag(key) && strings.TrimSpace(value) != "" {
			return true
		}
	}
	for _, stream := range metadata.Streams {
		for key, value := range stream.Tags {
			if isProtectionTag(key) && strings.TrimSpace(value) != "" {
				return true
			}
		}
	}
	return false
}

func isProtectionTag(key string) bool {
	key = strings.ToLower(key)
	return strings.Contains(key, "encrypt") || strings.Contains(key, "drm") || strings.Contains(key, "protection")
}
