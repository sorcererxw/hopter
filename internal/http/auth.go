package serverhttp

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"
)

const authLogoutCookieName = "hopter_logged_out"

type TerminalTabTerminator interface {
	TerminateBrowserTab(browserInstanceID, tabID string) int
}

type authLogoutRequest struct {
	BrowserInstanceID string `json:"browserInstanceId"`
	TabID             string `json:"tabId"`
}

func registerAuthHandlers(mux *http.ServeMux, terminals TerminalTabTerminator) {
	mux.HandleFunc("GET /api/auth/me", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{
			"ok": true,
			"data": map[string]any{
				"authenticated": !isLoggedOut(r),
				"user": map[string]any{
					"id":   "local-user",
					"mode": "localhost-no-password",
				},
			},
		})
	})

	mux.HandleFunc("POST /api/auth/login", func(w http.ResponseWriter, r *http.Request) {
		clearLogoutCookie(w)
		writeJSON(w, http.StatusOK, map[string]any{
			"ok": true,
			"data": map[string]any{
				"user": map[string]any{
					"id":   "local-user",
					"mode": "localhost-no-password",
				},
			},
		})
	})

	mux.HandleFunc("POST /api/auth/logout", func(w http.ResponseWriter, r *http.Request) {
		clearLogoutCookie(w)
		http.SetCookie(w, &http.Cookie{
			Name:     authLogoutCookieName,
			Value:    "1",
			Path:     "/",
			HttpOnly: true,
			SameSite: http.SameSiteLaxMode,
			Expires:  time.Now().Add(24 * time.Hour),
			MaxAge:   24 * 60 * 60,
		})

		var req authLogoutRequest
		_ = json.NewDecoder(r.Body).Decode(&req)
		terminatedCount := 0
		if terminals != nil && strings.TrimSpace(req.BrowserInstanceID) != "" && strings.TrimSpace(req.TabID) != "" {
			terminatedCount = terminals.TerminateBrowserTab(req.BrowserInstanceID, req.TabID)
		}

		writeJSON(w, http.StatusOK, map[string]any{
			"ok": true,
			"data": map[string]any{
				"loggedOut":       true,
				"terminatedCount": terminatedCount,
			},
		})
	})
}

func authGate(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if isLoggedOut(r) {
			writeJSON(w, http.StatusUnauthorized, map[string]any{
				"ok": false,
				"error": map[string]any{
					"code":    "AUTH_REQUIRED",
					"message": "login required",
				},
			})
			return
		}
		next.ServeHTTP(w, r)
	})
}

func authGateFunc(next http.HandlerFunc) http.Handler {
	return authGate(next)
}

func isLoggedOut(r *http.Request) bool {
	cookie, err := r.Cookie(authLogoutCookieName)
	if err != nil {
		return false
	}
	return cookie.Value == "1"
}

func clearLogoutCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     authLogoutCookieName,
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Expires:  time.Unix(0, 0),
		MaxAge:   -1,
	})
}
