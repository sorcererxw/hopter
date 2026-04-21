package serverhttp

import (
	"context"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/sorcererxw/hopter/internal/core"
)

const maxImageProxyBytes = 12 * 1024 * 1024

type imageProxyWorkspace interface {
	GetPathMetadata(path string) (core.PathMetadata, error)
}

func NewImageProxyHandler(workspace imageProxyWorkspace) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rawURL := strings.TrimSpace(r.URL.Query().Get("url"))
		rawPath := strings.TrimSpace(r.URL.Query().Get("path"))

		switch {
		case rawURL != "":
			proxyRemoteImage(w, r, rawURL)
		case rawPath != "":
			proxyLocalImage(w, rawPath, workspace)
		default:
			http.Error(w, "image url or path is required", http.StatusBadRequest)
		}
	})
}

func proxyRemoteImage(w http.ResponseWriter, r *http.Request, rawURL string) {
	parsed, err := url.Parse(rawURL)
	if err != nil || parsed == nil {
		http.Error(w, "invalid image url", http.StatusBadRequest)
		return
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		http.Error(w, "image url must use http or https", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, parsed.String(), nil)
	if err != nil {
		http.Error(w, "invalid image request", http.StatusBadRequest)
		return
	}
	req.Header.Set("Accept", "image/*")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		http.Error(w, "fetch image failed", http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		http.Error(w, fmt.Sprintf("fetch image status %d", resp.StatusCode), http.StatusBadGateway)
		return
	}

	contentType := strings.TrimSpace(resp.Header.Get("Content-Type"))
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	mediaType, _, _ := mime.ParseMediaType(contentType)
	if !strings.HasPrefix(strings.ToLower(mediaType), "image/") {
		http.Error(w, "proxied resource is not an image", http.StatusUnsupportedMediaType)
		return
	}

	writeImageResponse(w, contentType, resp.Body)
}

func proxyLocalImage(w http.ResponseWriter, rawPath string, workspace imageProxyWorkspace) {
	if workspace == nil {
		http.Error(w, "image proxy unavailable", http.StatusServiceUnavailable)
		return
	}

	metadata, err := workspace.GetPathMetadata(rawPath)
	if err != nil {
		http.Error(w, "image path unavailable", http.StatusNotFound)
		return
	}
	if metadata.IsDirectory || !metadata.IsAllowed {
		http.Error(w, "image path is not allowed", http.StatusForbidden)
		return
	}

	path := metadata.CanonicalPath
	file, err := os.Open(path)
	if err != nil {
		http.Error(w, "open image failed", http.StatusNotFound)
		return
	}
	defer file.Close()

	header := make([]byte, 512)
	n, _ := file.Read(header)
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		http.Error(w, "read image failed", http.StatusInternalServerError)
		return
	}

	contentType := localImageContentType(path, header[:n])
	if !strings.HasPrefix(strings.ToLower(contentType), "image/") {
		http.Error(w, "file is not an image", http.StatusUnsupportedMediaType)
		return
	}

	writeImageResponse(w, contentType, file)
}

func localImageContentType(path string, sample []byte) string {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".svg":
		return "image/svg+xml"
	case ".png":
		return "image/png"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".gif":
		return "image/gif"
	case ".webp":
		return "image/webp"
	}

	return http.DetectContentType(sample)
}

func writeImageResponse(w http.ResponseWriter, contentType string, body io.Reader) {
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Cache-Control", "private, max-age=300")
	w.WriteHeader(http.StatusOK)
	_, _ = io.Copy(w, io.LimitReader(body, maxImageProxyBytes))
}
