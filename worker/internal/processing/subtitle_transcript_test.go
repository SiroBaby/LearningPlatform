package processing

import (
	"errors"
	"strings"
	"testing"
)

func TestChunkTranscriptCitesTheLatestEndOfOverlappingCues(t *testing.T) {
	t.Parallel()
	// Arrange: the second cue starts inside the first and ends before it, so the last packed piece is not the
	// one that ends latest.
	segments := []ExtractedSegment{
		{Text: "cue dai", Locator: Locator{Kind: LocatorKindTime, StartSec: 10, EndSec: 90}},
		{Text: "cue ngan", Locator: Locator{Kind: LocatorKindTime, StartSec: 20, EndSec: 30}},
	}
	// Act
	chunks, err := ChunkTranscript(sttTestDocumentID, sttTestOwnerID, segments)
	// Assert
	if err != nil {
		t.Fatal(err)
	}
	if len(chunks) != 1 {
		t.Fatalf("chunks = %d, want 1", len(chunks))
	}
	if got := chunks[0].Locator; got.StartSec != 10 || got.EndSec != 90 {
		t.Fatalf("locator = %+v, want [10, 90] (max end, not the last piece end)", got)
	}
}

func TestChunkTranscriptKeepsLastEndForNonOverlappingCues(t *testing.T) {
	t.Parallel()
	segments := []ExtractedSegment{
		{Text: "mot", Locator: Locator{Kind: LocatorKindTime, StartSec: 0, EndSec: 5}},
		{Text: "hai", Locator: Locator{Kind: LocatorKindTime, StartSec: 5, EndSec: 12}},
	}

	chunks, err := ChunkTranscript(sttTestDocumentID, sttTestOwnerID, segments)

	if err != nil || len(chunks) != 1 || chunks[0].Locator.EndSec != 12 {
		t.Fatalf("chunks = %+v, err = %v, want one chunk ending at 12", chunks, err)
	}
}

func TestDecodeSubtitleCuesConvertsMillisecondsToSeconds(t *testing.T) {
	t.Parallel()
	raw := []byte(`[{"startMs":500,"endMs":4500,"text":"Xin chào"},{"startMs":1000,"endMs":3723456,"text":"Đoạn cuối"}]`)

	segments, err := DecodeSubtitleCues(raw)

	if err != nil {
		t.Fatal(err)
	}
	want := []TranscriptSegment{
		{StartSec: 0.5, EndSec: 4.5, Text: "Xin chào"},
		{StartSec: 1, EndSec: 3723.456, Text: "Đoạn cuối"},
	}
	if len(segments) != len(want) {
		t.Fatalf("segments = %+v, want %+v", segments, want)
	}
	for index := range want {
		if segments[index] != want[index] {
			t.Fatalf("segment %d = %+v, want %+v", index, segments[index], want[index])
		}
	}
}

func TestDecodeSubtitleCuesRejectsBrokenSnapshots(t *testing.T) {
	t.Parallel()
	tooManyCues := "[" + strings.TrimSuffix(strings.Repeat(`{"startMs":0,"endMs":1,"text":"x"},`, MaxSubtitleCues+1), ",") + "]"
	tooManyRunes := `[{"startMs":0,"endMs":1,"text":"` + strings.Repeat("a", MaxSubtitleRunes+1) + `"}]`
	tests := []struct {
		name     string
		raw      string
		wantCode FailureCode
	}{
		{name: "empty array", raw: `[]`, wantCode: MediaTranscriptEmpty},
		{name: "not an array", raw: `{"startMs":0}`, wantCode: ProcessingFailed},
		{name: "not json", raw: `nope`, wantCode: ProcessingFailed},
		{name: "empty input", raw: ``, wantCode: ProcessingFailed},
		{name: "trailing data", raw: `[{"startMs":0,"endMs":1,"text":"x"}] []`, wantCode: ProcessingFailed},
		{name: "unknown field", raw: `[{"startMs":0,"endMs":1,"text":"x","extra":1}]`, wantCode: ProcessingFailed},
		{name: "fractional milliseconds", raw: `[{"startMs":0.5,"endMs":1,"text":"x"}]`, wantCode: ProcessingFailed},
		{name: "negative start", raw: `[{"startMs":-1,"endMs":1,"text":"x"}]`, wantCode: ProcessingFailed},
		{name: "end equals start", raw: `[{"startMs":5,"endMs":5,"text":"x"}]`, wantCode: ProcessingFailed},
		{name: "end before start", raw: `[{"startMs":5,"endMs":4,"text":"x"}]`, wantCode: ProcessingFailed},
		{name: "end beyond 24 hours", raw: `[{"startMs":0,"endMs":86400001,"text":"x"}]`, wantCode: ProcessingFailed},
		{name: "decreasing starts", raw: `[{"startMs":10,"endMs":20,"text":"x"},{"startMs":9,"endMs":20,"text":"y"}]`, wantCode: ProcessingFailed},
		{name: "NUL in text", raw: `[{"startMs":0,"endMs":1,"text":"a\u0000b"}]`, wantCode: ProcessingFailed},
		{name: "C1 control in text", raw: `[{"startMs":0,"endMs":1,"text":"a\u0085b"}]`, wantCode: ProcessingFailed},
		{name: "DEL in text", raw: `[{"startMs":0,"endMs":1,"text":"a\u007fb"}]`, wantCode: ProcessingFailed},
		{name: "blank text", raw: `[{"startMs":0,"endMs":1,"text":"  "}]`, wantCode: ProcessingFailed},
		{name: "overflowing number", raw: `[{"startMs":99999999999999999999,"endMs":1,"text":"x"}]`, wantCode: ProcessingFailed},
		{name: "too many cues", raw: tooManyCues, wantCode: ProcessingFailed},
		{name: "too many runes", raw: tooManyRunes, wantCode: ProcessingFailed},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			// Act
			segments, err := DecodeSubtitleCues([]byte(test.raw))
			// Assert
			var failure Failure
			if !errors.As(err, &failure) || failure.Code != test.wantCode || failure.Technical {
				t.Fatalf("DecodeSubtitleCues() = %+v, %v, want non-technical %s", segments, err, test.wantCode)
			}
		})
	}
}

func TestDecodeSubtitleCuesAcceptsTheCapsExactly(t *testing.T) {
	t.Parallel()
	raw := `[{"startMs":0,"endMs":86400000,"text":"` + strings.Repeat("ạ", MaxSubtitleRunes) + `"}]`

	segments, err := DecodeSubtitleCues([]byte(raw))

	if err != nil || len(segments) != 1 || segments[0].EndSec != 86400 {
		t.Fatalf("DecodeSubtitleCues() = %d segments, %v, want one segment ending at 86400", len(segments), err)
	}
}
