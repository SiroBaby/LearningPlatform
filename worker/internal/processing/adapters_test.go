package processing

import (
	"bytes"
	"fmt"
	"strings"
	"testing"
	"unicode/utf8"
)

func TestExtractTextNormalizesMalformedUTF8PreservingWordBoundaries(t *testing.T) {
	input := string([]byte("valid \xe2\x82\xac invalid\xffbytes"))
	want := "valid \u20ac invalid bytes"

	segments, err := Extract(Source{Type: "TEXT"}, []byte(input))
	if err != nil {
		t.Fatalf("Extract(TEXT) error = %v", err)
	}
	if len(segments) != 1 || segments[0].Text != want {
		t.Fatalf("Extract(TEXT) = %#v, want one segment with %q", segments, want)
	}
	if !utf8.ValidString(segments[0].Text) {
		t.Fatal("Extract(TEXT) returned invalid UTF-8")
	}
}

func TestExtractTextPreservesValidReplacementCharacter(t *testing.T) {
	input := "before \uFFFD after"

	segments, err := Extract(Source{Type: "TEXT"}, []byte(input))
	if err != nil {
		t.Fatalf("Extract(TEXT) error = %v", err)
	}
	if len(segments) != 1 || segments[0].Text != input {
		t.Fatalf("Extract(TEXT) = %#v, want one segment with %q", segments, input)
	}
	if !utf8.ValidString(segments[0].Text) {
		t.Fatal("Extract(TEXT) returned invalid UTF-8")
	}
}

func TestExtractPDFPreservesDecodedReplacementCharacter(t *testing.T) {
	segments, err := Extract(Source{Type: "PDF"}, syntheticPDF([]byte{0xff, ' ', 'v', 'a', 'l', 'i', 'd'}))
	if err != nil {
		t.Fatalf("Extract(PDF) error = %v", err)
	}
	if len(segments) != 1 || segments[0].Text != "\uFFFD valid" {
		t.Fatalf("Extract(PDF) = %#v, want one segment preserving replacement character", segments)
	}
}

func TestExtractPDFKeepsLiteralSpacesInContentStreamOrder(t *testing.T) {
	stream := []byte("BT\n1 0 0 1 500 100 Tm\n[(First ) 40 (content-stream ) -10 (phrase )] TJ\n1 0 0 1 100 700 Tm\n[(comes ) 40 (before)] TJ\nET\n")

	segments, err := Extract(Source{Type: "PDF"}, syntheticPDFStream(stream))
	if err != nil {
		t.Fatalf("Extract(PDF) error = %v", err)
	}
	if len(segments) != 1 {
		t.Fatalf("Extract(PDF) returned %d segments, want one", len(segments))
	}
	if got, want := segments[0].Text, "First content-stream phrase comes before"; got != want {
		t.Fatalf("Extract(PDF) text = %q, want %q", got, want)
	}
}

func TestExtractPDFPreservesPageLocatorsAndSkipsEmptyPages(t *testing.T) {
	pageOne := []byte("BT\n1 0 0 1 72 700 Tm\n[(Page one)] TJ\nET\n")
	pageThree := []byte("BT\n1 0 0 1 72 700 Tm\n[(Page three)] TJ\nET\n")

	segments, err := Extract(Source{Type: "PDF"}, syntheticPDFPages(pageOne, nil, pageThree))
	if err != nil {
		t.Fatalf("Extract(PDF) error = %v", err)
	}
	if len(segments) != 2 {
		t.Fatalf("Extract(PDF) returned %d segments, want two", len(segments))
	}
	if got, want := segments[0].Text, "Page one"; got != want {
		t.Fatalf("first page text = %q, want %q", got, want)
	}
	if got, want := segments[0].Locator.Page, 1; got != want {
		t.Fatalf("first page locator = %d, want %d", got, want)
	}
	if got, want := segments[1].Text, "Page three"; got != want {
		t.Fatalf("third page text = %q, want %q", got, want)
	}
	if got, want := segments[1].Locator.Page, 3; got != want {
		t.Fatalf("third page locator = %d, want %d", got, want)
	}
}

func syntheticPDF(content []byte) []byte {
	stream := append([]byte("BT\n1 0 0 1 10 10 Tm\n("), content...)
	stream = append(stream, []byte(") Tj\nET\n")...)
	return syntheticPDFStream(stream)
}

func syntheticPDFStream(stream []byte) []byte {
	return syntheticPDFPages(stream)
}

func syntheticPDFPages(streams ...[]byte) []byte {
	if len(streams) == 0 {
		streams = [][]byte{nil}
	}

	pageObjects := make([][]byte, 0, len(streams))
	contentObjects := make([][]byte, 0, len(streams))
	for index, stream := range streams {
		contentNumber := 3 + len(streams) + index
		pageObjects = append(pageObjects, []byte(fmt.Sprintf("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << >> /Contents %d 0 R >>", contentNumber)))
		contentObjects = append(contentObjects, []byte(fmt.Sprintf("<< /Length %d >>\nstream\n%sendstream", len(stream), stream)))
	}

	kids := make([]string, 0, len(pageObjects))
	for index := range pageObjects {
		kids = append(kids, fmt.Sprintf("%d 0 R", 3+index))
	}
	objects := [][]byte{
		[]byte("<< /Type /Catalog /Pages 2 0 R >>"),
		[]byte(fmt.Sprintf("<< /Type /Pages /Kids [%s] /Count %d >>", strings.Join(kids, " "), len(pageObjects))),
	}
	objects = append(objects, pageObjects...)
	objects = append(objects, contentObjects...)

	var document bytes.Buffer
	document.WriteString("%PDF-1.4\n")
	offsets := make([]int, len(objects)+1)
	for index, object := range objects {
		number := index + 1
		offsets[number] = document.Len()
		fmt.Fprintf(&document, "%d 0 obj\n", number)
		document.Write(object)
		document.WriteString("\nendobj\n")
	}
	xrefOffset := document.Len()
	fmt.Fprintf(&document, "xref\n0 %d\n", len(offsets))
	document.WriteString("0000000000 65535 f \n")
	for _, offset := range offsets[1:] {
		fmt.Fprintf(&document, "%010d 00000 n \n", offset)
	}
	fmt.Fprintf(&document, "trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n", len(offsets), xrefOffset)
	return document.Bytes()
}
