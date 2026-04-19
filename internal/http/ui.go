package serverhttp

import (
	"bytes"
	"fmt"
	"io/fs"
	"mime"
	"net/http"
	"net/http/httputil"
	"net/url"
	"path"
	"path/filepath"
	"strings"
	"time"

	appui "github.com/sorcererxw/hopter/ui"
)

type UIHandlerOptions struct {
	DevProxyURL string
}

func (o UIHandlerOptions) Mode() string {
	if strings.TrimSpace(o.DevProxyURL) != "" {
		return "dev-proxy"
	}
	return "dist"
}

func NewUIHandler(opts UIHandlerOptions) (http.Handler, error) {
	if strings.TrimSpace(opts.DevProxyURL) != "" {
		target, err := url.Parse(opts.DevProxyURL)
		if err != nil {
			return nil, fmt.Errorf("parse HOPTER_UI_DEV_PROXY_URL: %w", err)
		}
		proxy := httputil.NewSingleHostReverseProxy(target)
		proxy.ErrorHandler = func(w http.ResponseWriter, r *http.Request, err error) {
			http.Error(w, fmt.Sprintf("vite dev server unavailable at %s: %v", target.String(), err), http.StatusBadGateway)
		}
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Method != http.MethodGet && r.Method != http.MethodHead {
				http.NotFound(w, r)
				return
			}
			proxy.ServeHTTP(w, r)
		}), nil
	}

	return &distUIHandler{fs: appui.DistFS()}, nil
}

type distUIHandler struct {
	fs fs.FS
}

func (h *distUIHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.NotFound(w, r)
		return
	}

	cleanPath := cleanUIPath(r.URL.Path)
	if isStaticAsset(cleanPath) {
		h.serveExactFile(w, r, cleanPath)
		return
	}

	if cleanPath == "index.html" || isUIPath(r.URL.Path) {
		h.serveIndex(w, r)
		return
	}

	if _, err := fs.Stat(h.fs, cleanPath); err == nil {
		h.serveExactFile(w, r, cleanPath)
		return
	}

	h.serveIndex(w, r)
}

func (h *distUIHandler) serveIndex(w http.ResponseWriter, r *http.Request) {
	h.serveExactFile(w, r, "index.html")
}

func (h *distUIHandler) serveExactFile(w http.ResponseWriter, r *http.Request, name string) {
	data, err := fs.ReadFile(h.fs, name)
	if err != nil {
		http.NotFound(w, r)
		return
	}

	contentType := mime.TypeByExtension(filepath.Ext(name))
	if contentType == "" {
		contentType = http.DetectContentType(data)
	}
	w.Header().Set("Content-Type", contentType)
	if strings.HasPrefix(name, "assets/") {
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	} else {
		w.Header().Set("Cache-Control", "no-store")
	}
	http.ServeContent(w, r, name, time.Time{}, bytes.NewReader(data))
}

func cleanUIPath(raw string) string {
	cleaned := path.Clean("/" + raw)
	if cleaned == "/" {
		return "index.html"
	}
	return strings.TrimPrefix(cleaned, "/")
}

func isStaticAsset(name string) bool {
	if strings.HasPrefix(name, "assets/") {
		return true
	}
	switch name {
	case "favicon.ico", "manifest.webmanifest", "sw.js":
		return true
	default:
		return false
	}
}
