package serverhttp

import (
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	"github.com/sorcererxw/hopter/internal/core"
)

const maxFileProxyBytes = 32 * 1024 * 1024

type fileProxyWorkspace interface {
	GetPathMetadata(path string) (core.PathMetadata, error)
}

func NewFileProxyHandler(workspace fileProxyWorkspace) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rawPath := strings.TrimSpace(r.URL.Query().Get("path"))
		if rawPath == "" {
			http.Error(w, "file path is required", http.StatusBadRequest)
			return
		}
		proxyLocalFile(w, rawPath, workspace)
	})
}

func proxyLocalFile(w http.ResponseWriter, rawPath string, workspace fileProxyWorkspace) {
	if workspace == nil {
		http.Error(w, "file proxy unavailable", http.StatusServiceUnavailable)
		return
	}

	metadata, err := getFileProxyPathMetadata(workspace, rawPath)
	if err != nil {
		http.Error(w, "file path unavailable", http.StatusNotFound)
		return
	}
	if metadata.IsDirectory || !metadata.IsAllowed {
		http.Error(w, "file path is not allowed", http.StatusForbidden)
		return
	}

	path := metadata.CanonicalPath
	file, err := os.Open(path)
	if err != nil {
		http.Error(w, "open file failed", http.StatusNotFound)
		return
	}
	defer file.Close()

	header := make([]byte, 512)
	n, _ := file.Read(header)
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		http.Error(w, "read file failed", http.StatusInternalServerError)
		return
	}

	contentType := localFileContentType(path, header[:n])
	filename := filepath.Base(path)
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Cache-Control", "private, max-age=300")
	w.Header().Set("Content-Disposition", fmt.Sprintf("inline; filename*=UTF-8''%s", url.PathEscape(filename)))
	w.WriteHeader(http.StatusOK)
	_, _ = io.Copy(w, io.LimitReader(file, maxFileProxyBytes))
}

func localFileContentType(path string, sample []byte) string {
	if ext := strings.ToLower(filepath.Ext(path)); ext != "" {
		switch ext {
		case ".ts", ".tsx":
			return "text/typescript; charset=utf-8"
		}
		if contentType := mime.TypeByExtension(ext); contentType != "" {
			return contentType
		}
	}

	return http.DetectContentType(sample)
}

func getFileProxyPathMetadata(workspace fileProxyWorkspace, rawPath string) (core.PathMetadata, error) {
	var lastErr error
	for _, path := range fileProxyPathCandidates(rawPath) {
		metadata, err := workspace.GetPathMetadata(path)
		if err == nil {
			return metadata, nil
		}
		lastErr = err
	}
	return core.PathMetadata{}, lastErr
}

func fileProxyPathCandidates(rawPath string) []string {
	path := strings.TrimSpace(rawPath)
	if path == "" {
		return nil
	}

	candidates := []string{path}
	if stripped := stripFileLocationSuffix(path); stripped != path {
		candidates = append(candidates, stripped)
	}
	return candidates
}

func stripFileLocationSuffix(path string) string {
	stripped := path
	for {
		index := strings.LastIndex(stripped, ":")
		if index <= 0 || index == len(stripped)-1 {
			return stripped
		}
		if !isDecimalSuffix(stripped[index+1:]) {
			return stripped
		}
		stripped = stripped[:index]
	}
}

func isDecimalSuffix(value string) bool {
	for _, char := range value {
		if char < '0' || char > '9' {
			return false
		}
	}
	return value != ""
}
