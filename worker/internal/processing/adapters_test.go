package processing

import (
	"bytes"
	"fmt"
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

func syntheticPDF(content []byte) []byte {
	stream := append([]byte("BT\n10 10 Td\n("), content...)
	stream = append(stream, []byte(") Tj\nET\n")...)
	objects := [][]byte{
		[]byte("<< /Type /Catalog /Pages 2 0 R >>"),
		[]byte("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
		[]byte("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << >> /Contents 4 0 R >>"),
		[]byte(fmt.Sprintf("<< /Length %d >>\nstream\n%sendstream", len(stream), stream)),
	}

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
