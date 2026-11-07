package processing

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"os"
	"reflect"
	"strings"
	"testing"
	"unicode/utf8"
)

const (
	sttTestDocumentID = "11111111-1111-4111-8111-111111111111"
	sttTestOwnerID    = "22222222-2222-4222-8222-222222222222"
)

type transcriptFixture struct {
	DurationSec float64             `json:"durationSec"`
	BodySec     float64             `json:"bodySec"`
	OverlapSec  float64             `json:"overlapSec"`
	Chunks      []AudioChunkResult  `json:"chunks"`
	Expected    []TranscriptSegment `json:"expected"`
}

func loadTranscriptFixture(t *testing.T) transcriptFixture {
	t.Helper()
	raw, err := os.ReadFile("../../testdata/stt/vi-lecture.transcript.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture transcriptFixture
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatal(err)
	}
	return fixture
}

func TestLocatorTimeWireFormat(t *testing.T) {
	tests := []struct {
		name     string
		locator  Locator
		expected string
	}{
		{"time keeps zero start", Locator{Kind: "time", StartSec: 0, EndSec: 12.5}, `{"kind":"time","startSec":0,"endSec":12.5}`},
		{"time keeps zero both", Locator{Kind: "time"}, `{"kind":"time","startSec":0,"endSec":0}`},
		{"time ignores page and range fields", Locator{Kind: "time", StartSec: 1.25, EndSec: 3, Page: 9, Start: 4, End: 5}, `{"kind":"time","startSec":1.25,"endSec":3}`},
		{"page is byte-for-byte unchanged", Locator{Kind: "page", Page: 3, Start: 1, End: 14, StartSec: 7, EndSec: 8}, `{"kind":"page","page":3}`},
		{"text-range is byte-for-byte unchanged", Locator{Kind: "text-range", Start: 0, End: 14, Page: 3, StartSec: 7}, `{"kind":"text-range","start":0,"end":14}`},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			actual, err := json.Marshal(test.locator)
			if err != nil {
				t.Fatal(err)
			}
			if string(actual) != test.expected {
				t.Fatalf("locator JSON = %s, want %s", actual, test.expected)
			}
		})
	}
}

func TestLocatorTimeNestedInChunkAndCitationJSON(t *testing.T) {
	citation := Citation{ChunkID: "c", Locator: Locator{Kind: "time", StartSec: 0, EndSec: 4}, Snippet: "xin chào"}
	actual, err := json.Marshal(citation)
	if err != nil {
		t.Fatal(err)
	}
	expected := `{"chunkId":"c","locator":{"kind":"time","startSec":0,"endSec":4},"snippet":"xin chào"}`
	if string(actual) != expected {
		t.Fatalf("citation JSON = %s, want %s", actual, expected)
	}
}

func TestPlanAudioChunks(t *testing.T) {
	tests := []struct {
		name     string
		duration float64
		body     float64
		overlap  float64
		expected []AudioChunkSpan
		wantErr  bool
	}{
		{name: "shorter than one body", duration: 45, body: 600, overlap: 5, expected: []AudioChunkSpan{{0, 0, 45, 0, 45}}},
		{name: "exact multiple", duration: 1200, body: 600, overlap: 5, expected: []AudioChunkSpan{{0, 0, 600, 0, 605}, {1, 600, 1200, 595, 1200}}},
		{name: "last chunk shorter keeps its own chunk", duration: 1250, body: 600, overlap: 5, expected: []AudioChunkSpan{{0, 0, 600, 0, 605}, {1, 600, 1200, 595, 1205}, {2, 1200, 1250, 1195, 1250}}},
		{name: "tiny tail merges into previous", duration: 1205, body: 600, overlap: 5, expected: []AudioChunkSpan{{0, 0, 600, 0, 605}, {1, 600, 1205, 595, 1205}}},
		{name: "zero duration", duration: 0, body: 600, overlap: 5, wantErr: true},
		{name: "negative duration", duration: -1, body: 600, overlap: 5, wantErr: true},
		{name: "NaN duration", duration: math.NaN(), body: 600, overlap: 5, wantErr: true},
		{name: "overlap too large", duration: 100, body: 10, overlap: 5, wantErr: true},
		{name: "negative overlap", duration: 100, body: 10, overlap: -1, wantErr: true},
		{name: "huge duration with tiny body does not allocate", duration: 1e12, body: 0.01, overlap: 0, wantErr: true},
		{name: "duration above media maximum", duration: 7201, body: 600, overlap: 5, wantErr: true},
		{name: "body below minimum", duration: 100, body: 0.5, overlap: 0, wantErr: true},
		{name: "infinite body", duration: 100, body: math.Inf(1), overlap: 0, wantErr: true},
		{name: "too many chunks", duration: 7200, body: 1, overlap: 0, wantErr: true},
		{name: "maximum duration is accepted", duration: 7200, body: 600, overlap: 5, expected: nil},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			actual, err := PlanAudioChunks(test.duration, test.body, test.overlap)
			if test.wantErr {
				if !errors.Is(err, ErrInvalidAudioPlan) {
					t.Fatalf("error = %v, want ErrInvalidAudioPlan", err)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if test.expected == nil {
				if len(actual) != 12 {
					t.Fatalf("chunks = %d, want 12", len(actual))
				}
				return
			}
			if !reflect.DeepEqual(actual, test.expected) {
				t.Fatalf("plan = %+v, want %+v", actual, test.expected)
			}
		})
	}
}

func TestStitchTranscriptFixtureViaFakeTranscriber(t *testing.T) {
	fixture := loadTranscriptFixture(t)
	spans, err := PlanAudioChunks(fixture.DurationSec, fixture.BodySec, fixture.OverlapSec)
	if err != nil {
		t.Fatal(err)
	}
	fake := FakeTranscriber{Results: map[int][]TranscriptSegment{}}
	for _, chunk := range fixture.Chunks {
		fake.Results[chunk.Index] = chunk.Segments
	}
	results := make([]AudioChunkResult, 0, len(spans))
	for _, span := range spans {
		segments, err := fake.Transcribe(context.Background(), TranscribeRequest{ChunkIndex: span.Index, Language: "vi"})
		if err != nil {
			t.Fatal(err)
		}
		results = append(results, AudioChunkResult{Index: span.Index, Segments: segments})
	}
	actual, err := StitchTranscript(fixture.DurationSec, spans, results)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(actual, fixture.Expected) {
		t.Fatalf("stitched = %+v, want %+v", actual, fixture.Expected)
	}
	chunks, err := ChunkTranscript(sttTestDocumentID, sttTestOwnerID, TimedSegmentsToExtracted(actual))
	if err != nil {
		t.Fatal(err)
	}
	if len(chunks) != 1 {
		t.Fatalf("chunks = %d, want 1", len(chunks))
	}
	if chunks[0].Locator != (Locator{Kind: "time", StartSec: 0, EndSec: 42}) {
		t.Fatalf("locator = %+v", chunks[0].Locator)
	}
	if !strings.Contains(chunks[0].Text, "Trái Đất") || !strings.Contains(chunks[0].Text, "ôxi") {
		t.Fatalf("diacritics lost: %q", chunks[0].Text)
	}
}

func segment(start, end float64, text string) TranscriptSegment {
	return TranscriptSegment{StartSec: start, EndSec: end, Text: text}
}

func TestStitchTranscriptEdgeCases(t *testing.T) {
	twoSpans := []AudioChunkSpan{{0, 0, 20, 0, 22}, {1, 20, 42, 18, 42}}
	tests := []struct {
		name     string
		duration float64
		spans    []AudioChunkSpan
		results  []AudioChunkResult
		expected []TranscriptSegment
		wantErr  bool
	}{
		{
			name: "zero start is kept", duration: 10, spans: []AudioChunkSpan{{0, 0, 10, 0, 10}},
			results:  []AudioChunkResult{{0, []TranscriptSegment{segment(0, 2, "một")}}},
			expected: []TranscriptSegment{segment(0, 2, "một")},
		},
		{
			name: "overlap duplicate is dropped by midpoint ownership", duration: 42, spans: twoSpans,
			results: []AudioChunkResult{
				{0, []TranscriptSegment{segment(19, 21.5, "lặp")}},
				{1, []TranscriptSegment{segment(1, 3.5, "lặp")}},
			},
			expected: []TranscriptSegment{segment(19, 21.5, "lặp")},
		},
		{
			name: "out of order segments are sorted", duration: 10, spans: []AudioChunkSpan{{0, 0, 10, 0, 10}},
			results:  []AudioChunkResult{{0, []TranscriptSegment{segment(5, 6, "hai"), segment(1, 2, "một")}}},
			expected: []TranscriptSegment{segment(1, 2, "một"), segment(5, 6, "hai")},
		},
		{
			name: "gaps are preserved", duration: 100, spans: []AudioChunkSpan{{0, 0, 100, 0, 100}},
			results:  []AudioChunkResult{{0, []TranscriptSegment{segment(0, 1, "a"), segment(60, 61, "b")}}},
			expected: []TranscriptSegment{segment(0, 1, "a"), segment(60, 61, "b")},
		},
		{
			name: "shorter last chunk with offset", duration: 42, spans: twoSpans,
			results: []AudioChunkResult{
				{0, nil},
				{1, []TranscriptSegment{segment(20, 24, "cuối")}},
			},
			expected: []TranscriptSegment{segment(38, 42, "cuối")},
		},
		{
			name: "end beyond duration within tolerance is clamped", duration: 10, spans: []AudioChunkSpan{{0, 0, 10, 0, 10}},
			results:  []AudioChunkResult{{0, []TranscriptSegment{segment(8, 10.6, "hết")}}},
			expected: []TranscriptSegment{segment(8, 10, "hết")},
		},
		{
			name: "start beyond duration tolerance is invalid", duration: 10, spans: []AudioChunkSpan{{0, 0, 10, 0, 10}},
			results: []AudioChunkResult{{0, []TranscriptSegment{segment(12, 13, "vượt")}}},
			wantErr: true,
		},
		{
			name: "end beyond duration tolerance is invalid", duration: 42, spans: twoSpans,
			results: []AudioChunkResult{{0, nil}, {1, []TranscriptSegment{segment(3, 9999, "vượt")}}},
			wantErr: true,
		},
		{
			name: "result for unknown chunk is invalid", duration: 10, spans: []AudioChunkSpan{{0, 0, 10, 0, 10}},
			results: []AudioChunkResult{{0, nil}, {7, nil}},
			wantErr: true,
		},
		{
			name: "start regressing across chunks beyond tolerance is invalid", duration: 42, spans: twoSpans,
			results: []AudioChunkResult{
				{0, []TranscriptSegment{segment(19.9, 19.95, "a")}},
				{1, []TranscriptSegment{segment(0, 6, "b")}},
			},
			wantErr: true,
		},
		{
			name: "start regressing across chunks within tolerance is lifted", duration: 42, spans: twoSpans,
			results: []AudioChunkResult{
				{0, []TranscriptSegment{segment(19.9, 19.95, "a")}},
				{1, []TranscriptSegment{segment(1, 9, "b")}},
			},
			expected: []TranscriptSegment{segment(19.9, 19.95, "a"), segment(19.9, 27, "b")},
		},
		{
			name: "negative start is invalid", duration: 10, spans: []AudioChunkSpan{{0, 0, 10, 0, 10}},
			results: []AudioChunkResult{{0, []TranscriptSegment{segment(-1, 1, "âm")}}},
			wantErr: true,
		},
		{
			name: "reversed times are invalid", duration: 10, spans: []AudioChunkSpan{{0, 0, 10, 0, 10}},
			results: []AudioChunkResult{{0, []TranscriptSegment{segment(5, 4, "ngược")}}},
			wantErr: true,
		},
		{
			name: "NaN time is invalid", duration: 10, spans: []AudioChunkSpan{{0, 0, 10, 0, 10}},
			results: []AudioChunkResult{{0, []TranscriptSegment{segment(math.NaN(), 4, "nan")}}},
			wantErr: true,
		},
		{
			name: "empty and whitespace segments are dropped", duration: 10, spans: []AudioChunkSpan{{0, 0, 10, 0, 10}},
			results:  []AudioChunkResult{{0, []TranscriptSegment{segment(0, 1, ""), segment(1, 2, " \n\t "), segment(2, 3, "  xin   chào ")}}},
			expected: []TranscriptSegment{segment(2, 3, "xin chào")},
		},
		{
			name: "empty transcript is not an error", duration: 10, spans: []AudioChunkSpan{{0, 0, 10, 0, 10}},
			results:  []AudioChunkResult{{0, nil}},
			expected: []TranscriptSegment{},
		},
		{
			name: "missing chunk result is invalid", duration: 42, spans: twoSpans,
			results: []AudioChunkResult{{0, nil}},
			wantErr: true,
		},
		{
			name: "duplicate chunk result is invalid", duration: 10, spans: []AudioChunkSpan{{0, 0, 10, 0, 10}},
			results: []AudioChunkResult{{0, nil}, {0, nil}},
			wantErr: true,
		},
		{
			name: "rounds to milliseconds", duration: 10, spans: []AudioChunkSpan{{0, 0, 10, 0, 10}},
			results:  []AudioChunkResult{{0, []TranscriptSegment{segment(0.12345, 1.98765, "làm tròn")}}},
			expected: []TranscriptSegment{segment(0.123, 1.988, "làm tròn")},
		},
		{
			name: "overlapping neighbours stay monotonic", duration: 10, spans: []AudioChunkSpan{{0, 0, 10, 0, 10}},
			results:  []AudioChunkResult{{0, []TranscriptSegment{segment(0, 5, "a"), segment(3, 4, "b")}}},
			expected: []TranscriptSegment{segment(0, 5, "a"), segment(3, 4, "b")},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			actual, err := StitchTranscript(test.duration, test.spans, test.results)
			if test.wantErr {
				if err == nil {
					t.Fatalf("expected error, got %+v", actual)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(actual, test.expected) {
				t.Fatalf("stitched = %+v, want %+v", actual, test.expected)
			}
			assertMonotonic(t, actual, test.duration)
		})
	}
}

func assertMonotonic(t *testing.T, segments []TranscriptSegment, duration float64) {
	t.Helper()
	previous := 0.0
	for _, item := range segments {
		if item.StartSec < previous || item.EndSec < item.StartSec || item.EndSec > duration {
			t.Fatalf("non-monotonic or out of range: %+v (previous start %v, duration %v)", item, previous, duration)
		}
		previous = item.StartSec
	}
}

func TestStitchTranscriptRejectsInvalidInputs(t *testing.T) {
	if _, err := StitchTranscript(0, []AudioChunkSpan{{0, 0, 1, 0, 1}}, nil); !errors.Is(err, ErrInvalidAudioPlan) {
		t.Fatalf("zero duration error = %v", err)
	}
	if _, err := StitchTranscript(10, nil, nil); !errors.Is(err, ErrInvalidAudioPlan) {
		t.Fatalf("no spans error = %v", err)
	}
}

func TestFakeTranscriber(t *testing.T) {
	canned := []TranscriptSegment{segment(0, 1, "xin chào")}
	fake := FakeTranscriber{Results: map[int][]TranscriptSegment{0: canned}}
	var port Transcriber = fake
	actual, err := port.Transcribe(context.Background(), TranscribeRequest{ChunkIndex: 0})
	if err != nil || !reflect.DeepEqual(actual, canned) {
		t.Fatalf("actual = %+v, err = %v", actual, err)
	}
	actual[0].Text = "mutated"
	if canned[0].Text != "xin chào" {
		t.Fatal("fake returned shared backing array")
	}
	if _, err := fake.Transcribe(context.Background(), TranscribeRequest{ChunkIndex: 9}); !errors.Is(err, ErrFakeTranscriptMissing) {
		t.Fatalf("missing error = %v", err)
	}
	boom := errors.New("boom")
	if _, err := (FakeTranscriber{Err: boom}).Transcribe(context.Background(), TranscribeRequest{}); !errors.Is(err, boom) {
		t.Fatalf("forced error = %v", err)
	}
	cancelled, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := fake.Transcribe(cancelled, TranscribeRequest{ChunkIndex: 0}); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancelled error = %v", err)
	}
}

func TestChunkTranscript(t *testing.T) {
	long := strings.Repeat("giảng ", 40) // 240 bytes with multibyte runes
	sentence := func(index int) ExtractedSegment {
		return ExtractedSegment{
			Text:    long,
			Locator: Locator{Kind: "time", StartSec: float64(index) * 10, EndSec: float64(index)*10 + 10},
		}
	}
	segments := make([]ExtractedSegment, 0, 20)
	for index := 0; index < 20; index++ {
		segments = append(segments, sentence(index))
	}
	first, err := ChunkTranscript(sttTestDocumentID, sttTestOwnerID, segments)
	if err != nil {
		t.Fatal(err)
	}
	second, err := ChunkTranscript(sttTestDocumentID, sttTestOwnerID, segments)
	if err != nil || !reflect.DeepEqual(first, second) {
		t.Fatalf("not deterministic: %v", err)
	}
	if len(first) < 3 {
		t.Fatalf("expected several chunks, got %d", len(first))
	}
	for index, chunk := range first {
		if chunk.Index != index || len(chunk.Text) > maxChars || chunk.Locator.Kind != "time" {
			t.Fatalf("bad chunk %d: %+v", index, chunk)
		}
		if chunk.Locator.EndSec < chunk.Locator.StartSec {
			t.Fatalf("reversed locator %d: %+v", index, chunk.Locator)
		}
		if index > 0 && chunk.Locator.StartSec < first[index-1].Locator.StartSec {
			t.Fatalf("locator start not monotonic at %d", index)
		}
	}
	if first[0].Locator.StartSec != 0 || first[len(first)-1].Locator.EndSec != 200 {
		t.Fatalf("coverage = %v..%v", first[0].Locator.StartSec, first[len(first)-1].Locator.EndSec)
	}
}

func TestChunkTranscriptOverlapStartsWithinBudget(t *testing.T) {
	segments := []ExtractedSegment{
		{Text: strings.Repeat("a", 1000), Locator: Locator{Kind: "time", StartSec: 0, EndSec: 10}},
		{Text: strings.Repeat("b", 100), Locator: Locator{Kind: "time", StartSec: 10, EndSec: 20}},
		{Text: strings.Repeat("c", 100), Locator: Locator{Kind: "time", StartSec: 20, EndSec: 30}},
		{Text: strings.Repeat("d", 1000), Locator: Locator{Kind: "time", StartSec: 30, EndSec: 40}},
	}
	chunks, err := ChunkTranscript(sttTestDocumentID, sttTestOwnerID, segments)
	if err != nil {
		t.Fatal(err)
	}
	if len(chunks) < 2 {
		t.Fatalf("chunks = %d", len(chunks))
	}
	if chunks[0].Locator.EndSec != 30 || chunks[1].Locator.StartSec != 20 {
		t.Fatalf("overlap locators: %+v then %+v", chunks[0].Locator, chunks[1].Locator)
	}
}

func TestChunkTranscriptSplitsOversizedSegmentWithInterpolatedTimes(t *testing.T) {
	text := strings.TrimSpace(strings.Repeat("đoạn dài ", 400)) // ~3.2k bytes
	chunks, err := ChunkTranscript(sttTestDocumentID, sttTestOwnerID, []ExtractedSegment{
		{Text: text, Locator: Locator{Kind: "time", StartSec: 100, EndSec: 200}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(chunks) < 2 {
		t.Fatalf("chunks = %d", len(chunks))
	}
	for index, chunk := range chunks {
		if len(chunk.Text) > maxChars {
			t.Fatalf("chunk %d too long: %d", index, len(chunk.Text))
		}
		if chunk.Locator.StartSec < 100 || chunk.Locator.EndSec > 200 || chunk.Locator.EndSec <= chunk.Locator.StartSec {
			t.Fatalf("chunk %d locator out of range: %+v", index, chunk.Locator)
		}
	}
	if chunks[0].Locator.StartSec != 100 || chunks[len(chunks)-1].Locator.EndSec != 200 {
		t.Fatalf("span not covered: %+v .. %+v", chunks[0].Locator, chunks[len(chunks)-1].Locator)
	}
}

func TestChunkTranscriptEmptyAndBlank(t *testing.T) {
	for name, segments := range map[string][]ExtractedSegment{
		"nil":   nil,
		"blank": {{Text: "  \n ", Locator: Locator{Kind: "time"}}},
	} {
		t.Run(name, func(t *testing.T) {
			chunks, err := ChunkTranscript(sttTestDocumentID, sttTestOwnerID, segments)
			if err != nil || len(chunks) != 0 {
				t.Fatalf("chunks = %+v, err = %v", chunks, err)
			}
		})
	}
}

func TestChunkTranscriptKeepsZeroStartLocatorInJSON(t *testing.T) {
	chunks, err := ChunkTranscript(sttTestDocumentID, sttTestOwnerID, []ExtractedSegment{
		{Text: "xin chào", Locator: Locator{Kind: "time", StartSec: 0, EndSec: 2}},
	})
	if err != nil || len(chunks) != 1 {
		t.Fatalf("chunks = %+v, err = %v", chunks, err)
	}
	actual, err := json.Marshal(chunks[0].Locator)
	if err != nil || string(actual) != `{"kind":"time","startSec":0,"endSec":2}` {
		t.Fatalf("locator JSON = %s, err = %v", actual, err)
	}
}

func TestChunkTranscriptHardSplitsOversizedToken(t *testing.T) {
	token := strings.Repeat("ế", 850) // 2550 bytes, 850 runes, no spaces
	chunks, err := ChunkTranscript(sttTestDocumentID, sttTestOwnerID, []ExtractedSegment{
		{Text: token, Locator: Locator{Kind: "time", StartSec: 0, EndSec: 85}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(chunks) < 2 {
		t.Fatalf("chunks = %d", len(chunks))
	}
	for index, chunk := range chunks {
		if len(chunk.Text) > maxChars || !utf8.ValidString(chunk.Text) {
			t.Fatalf("chunk %d invalid: %d bytes valid=%v", index, len(chunk.Text), utf8.ValidString(chunk.Text))
		}
	}
}

func TestChunkTranscriptRoundsInterpolatedTimesToMillis(t *testing.T) {
	text := strings.TrimSpace(strings.Repeat("đoạn dài ", 400))
	chunks, err := ChunkTranscript(sttTestDocumentID, sttTestOwnerID, []ExtractedSegment{
		{Text: text, Locator: Locator{Kind: "time", StartSec: 0, EndSec: 100.0 / 3}},
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, chunk := range chunks[:len(chunks)-1] {
		for _, value := range []float64{chunk.Locator.StartSec, chunk.Locator.EndSec} {
			if value != roundMillis(value) {
				t.Fatalf("time %v is not rounded to milliseconds", value)
			}
		}
	}
}

func TestNewChunkKeepsExistingPDFChunkIDStable(t *testing.T) {
	chunks, err := ChunkText(sttTestDocumentID, sttTestOwnerID, []struct {
		Text    string
		Locator Locator
	}{{Text: "Nội dung trang một.", Locator: Locator{Kind: "page", Page: 1}}})
	if err != nil || len(chunks) != 1 {
		t.Fatalf("chunks = %+v, err = %v", chunks, err)
	}
	// Computed independently of Go (python uuid5(NAMESPACE_OID, "doc:owner:0:sha256")).
	if chunks[0].ID != "9430de94-3198-5f54-906e-be93fa87b1e9" ||
		chunks[0].ContentHash != "eaac84affdecf202fe73711f9b25a1188237886123b3d3aee4725fac90d4c87a" {
		t.Fatalf("chunk identity changed: %s %s", chunks[0].ID, chunks[0].ContentHash)
	}
}
