package serverhttp

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/sorcererxw/hopter/internal/core"
)

type fakeFileProxyWorkspace struct {
	metadata       core.PathMetadata
	metadataByPath map[string]core.PathMetadata
	err            error
	requested      *[]string
}

func (workspace fakeFileProxyWorkspace) GetPathMetadata(path string) (core.PathMetadata, error) {
	if workspace.requested != nil {
		*workspace.requested = append(*workspace.requested, path)
	}
	if workspace.metadataByPath != nil {
		metadata, ok := workspace.metadataByPath[path]
		if !ok {
			return core.PathMetadata{}, errors.New("not found")
		}
		return metadata, nil
	}
	return workspace.metadata, workspace.err
}

func TestFileProxyServesAllowedFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "report.md")
	if err := os.WriteFile(path, []byte("# Report\n"), 0o644); err != nil {
		t.Fatalf("write file: %v", err)
	}

	handler := NewFileProxyHandler(fakeFileProxyWorkspace{
		metadata: core.PathMetadata{
			CanonicalPath: path,
			IsAllowed:     true,
		},
	})
	req := httptest.NewRequest(http.MethodGet, "/api/file-proxy?path="+path, nil)
	recorder := httptest.NewRecorder()

	handler.ServeHTTP(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d: %s", recorder.Code, http.StatusOK, recorder.Body.String())
	}
	if got := recorder.Body.String(); got != "# Report\n" {
		t.Fatalf("body = %q", got)
	}
	if got := recorder.Header().Get("Content-Disposition"); !strings.Contains(got, "inline") || !strings.Contains(got, "report.md") {
		t.Fatalf("content disposition = %q", got)
	}
}

func TestFileProxyServesAllowedFileWithLineSuffix(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "messages.ts")
	if err := os.WriteFile(path, []byte("export const messages = {}\n"), 0o644); err != nil {
		t.Fatalf("write file: %v", err)
	}

	var requested []string
	handler := NewFileProxyHandler(fakeFileProxyWorkspace{
		metadataByPath: map[string]core.PathMetadata{
			path: {
				CanonicalPath: path,
				IsAllowed:     true,
			},
		},
		requested: &requested,
	})
	req := httptest.NewRequest(http.MethodGet, "/api/file-proxy?path="+path+":261", nil)
	recorder := httptest.NewRecorder()

	handler.ServeHTTP(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d: %s", recorder.Code, http.StatusOK, recorder.Body.String())
	}
	if got := recorder.Body.String(); got != "export const messages = {}\n" {
		t.Fatalf("body = %q", got)
	}
	if got := recorder.Header().Get("Content-Type"); got != "text/typescript; charset=utf-8" {
		t.Fatalf("content type = %q", got)
	}
	if len(requested) != 2 || requested[0] != path+":261" || requested[1] != path {
		t.Fatalf("requested paths = %#v", requested)
	}
}

func TestFileProxyRejectsDisallowedPath(t *testing.T) {
	handler := NewFileProxyHandler(fakeFileProxyWorkspace{
		metadata: core.PathMetadata{
			CanonicalPath: "/tmp/secret.txt",
			IsAllowed:     false,
		},
	})
	req := httptest.NewRequest(http.MethodGet, "/api/file-proxy?path=/tmp/secret.txt", nil)
	recorder := httptest.NewRecorder()

	handler.ServeHTTP(recorder, req)

	if recorder.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusForbidden)
	}
}
