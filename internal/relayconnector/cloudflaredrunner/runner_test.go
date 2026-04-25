package cloudflaredrunner

import (
	"context"
	"strings"
	"testing"
)

func TestRunnerRejectsMissingToken(t *testing.T) {
	err := (Runner{}).Start(context.Background(), " ")
	if err == nil {
		t.Fatal("expected missing token to fail")
	}
	if !strings.Contains(err.Error(), "missing connector token") {
		t.Fatalf("error = %v", err)
	}
}
