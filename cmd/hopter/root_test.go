package main

import (
	"bytes"
	"strings"
	"testing"

	"github.com/sorcererxw/hopter/internal/app"
)

func TestLocalBrowserURLUsesLoopbackForWildcardBind(t *testing.T) {
	got := localBrowserURL(app.HTTPConfig{Host: "0.0.0.0", Port: 18787})
	want := "http://127.0.0.1:18787"
	if got != want {
		t.Fatalf("localBrowserURL = %q, want %q", got, want)
	}
}

func TestLocalBrowserURLFormatsIPv6(t *testing.T) {
	got := localBrowserURL(app.HTTPConfig{Host: "::1", Port: 18787})
	want := "http://[::1]:18787"
	if got != want {
		t.Fatalf("localBrowserURL = %q, want %q", got, want)
	}
}

func TestPrintServeReadyGuidesUserToOpenURL(t *testing.T) {
	var buf bytes.Buffer
	printServeReady(&buf, app.Config{
		HTTP: app.HTTPConfig{Host: "127.0.0.1", Port: 18787},
	})

	output := buf.String()
	for _, want := range []string{
		"hopter is running",
		"Open: http://127.0.0.1:18787",
		"Stop: Ctrl+C",
	} {
		if !strings.Contains(output, want) {
			t.Fatalf("startup output missing %q:\n%s", want, output)
		}
	}
}
