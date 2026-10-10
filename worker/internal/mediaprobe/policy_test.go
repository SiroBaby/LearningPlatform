package mediaprobe

import (
	"errors"
	"testing"
)

func TestValidateMetadataAcceptsTheMVPMediaContract(t *testing.T) {
	tests := []struct {
		name     string
		metadata Metadata
		size     int64
	}{
		{
			name: "mp3",
			metadata: Metadata{
				Format:  FormatMetadata{Name: "mp3", Duration: "7199.1"},
				Streams: []StreamMetadata{{CodecType: "audio", CodecName: "mp3", Channels: 2}},
			},
			size: 300 * 1024 * 1024,
		},
		{
			name: "mp4 landscape at exact pixel cap",
			metadata: Metadata{
				Format: FormatMetadata{Name: "mov,mp4,m4a,3gp,3g2,mj2", Duration: "120"},
				Streams: []StreamMetadata{
					{CodecType: "video", CodecName: "h264", Profile: "High", PixelFormat: "yuv420p", CodedWidth: 1920, CodedHeight: 1080, AverageRate: "30000/1001"},
					{CodecType: "audio", CodecName: "aac", Profile: "LC", Channels: 2, IsDefault: true},
				},
			},
			size: 500 * 1024 * 1024,
		},
		{
			name: "mp4 portrait uses coded dimensions",
			metadata: Metadata{
				Format: FormatMetadata{Name: "mp4", Duration: "1"},
				Streams: []StreamMetadata{
					{CodecType: "video", CodecName: "h264", Profile: "Baseline", PixelFormat: "yuv420p", CodedWidth: 1080, CodedHeight: 1920, AverageRate: "30/1"},
					{CodecType: "audio", CodecName: "aac", Profile: "LC", Channels: 1, IsDefault: true},
				},
			},
			size: 1,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			result, err := ValidateMetadata(test.metadata, test.size)
			if err != nil {
				t.Fatalf("ValidateMetadata() error = %v", err)
			}
			if result.DurationSec <= 0 || result.Locator.ContentLength != test.size {
				t.Fatalf("result = %#v", result)
			}
		})
	}
}

func TestValidateMetadataRejectsInvalidMediaContract(t *testing.T) {
	base := Metadata{
		Format: FormatMetadata{Name: "mp4", Duration: "120"},
		Streams: []StreamMetadata{
			{CodecType: "video", CodecName: "h264", Profile: "Main", PixelFormat: "yuv420p", CodedWidth: 1920, CodedHeight: 1080, AverageRate: "30/1"},
			{CodecType: "audio", CodecName: "aac", Profile: "LC", Channels: 2, IsDefault: true},
		},
	}
	tests := []struct {
		name   string
		change func(*Metadata)
		code   FailureCode
	}{
		{name: "zero frame rate", change: func(metadata *Metadata) { metadata.Streams[0].AverageRate = "0/1" }, code: FailureUnsupportedVideoCodec},
		{name: "malformed frame rate", change: func(metadata *Metadata) { metadata.Streams[0].AverageRate = "not-a-rate" }, code: FailureUnsupportedVideoCodec},
		{name: "frame rate above cap", change: func(metadata *Metadata) { metadata.Streams[0].AverageRate = "60/1" }, code: FailureUnsupportedVideoCodec},
		{name: "coded edge above cap", change: func(metadata *Metadata) { metadata.Streams[0].CodedWidth = 1921 }, code: FailureUnsupportedVideoCodec},
		{name: "missing audio default", change: func(metadata *Metadata) { metadata.Streams[1].IsDefault = false }, code: FailureAudioTrackRequired},
		{name: "unsupported video codec", change: func(metadata *Metadata) { metadata.Streams[0].CodecName = "hevc" }, code: FailureUnsupportedVideoCodec},
		{name: "unsupported audio codec", change: func(metadata *Metadata) { metadata.Streams[1].CodecName = "opus" }, code: FailureUnsupportedAudioCodec},
		{name: "duration missing", change: func(metadata *Metadata) { metadata.Format.Duration = "N/A" }, code: FailureMediaProbe},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			metadata := base
			metadata.Streams = append([]StreamMetadata(nil), base.Streams...)
			test.change(&metadata)
			_, err := ValidateMetadata(metadata, 1)
			var failure Failure
			if !errors.As(err, &failure) || failure.Code != test.code {
				t.Fatalf("error = %v, want %s", err, test.code)
			}
		})
	}
}

func TestValidFrameRateRequiresPositiveRational(t *testing.T) {
	for _, test := range []struct {
		raw string
		ok  bool
	}{
		{raw: "29/1", ok: true},
		{raw: "30000/1001", ok: true},
		{raw: "0/1", ok: false},
		{raw: "0/0", ok: false},
		{raw: "31/1", ok: false},
		{raw: "1/-1", ok: false},
	} {
		if actual := validFrameRate(test.raw); actual != test.ok {
			t.Errorf("validFrameRate(%q) = %t, want %t", test.raw, actual, test.ok)
		}
	}
}
