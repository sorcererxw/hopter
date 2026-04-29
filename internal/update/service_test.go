package update

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/sorcererxw/hopter/internal/core"
)

func TestCheckUsesSignedManifest(t *testing.T) {
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}

	payload := manifestPayload{
		Product:     "hopter",
		Channel:     "stable",
		Version:     "1.2.4",
		PublishedAt: time.Date(2026, 4, 19, 12, 0, 0, 0, time.UTC),
		NotesURL:    "https://hopter.dev/releases/1.2.4",
		Artifacts: map[string]manifestArtifact{
			currentPlatformKey(): {
				URL:       "https://updates.hopter.dev/artifacts/1.2.4/hopter",
				SHA256:    strings.Repeat("a", 64),
				SizeBytes: 42,
			},
		},
	}
	payloadJSON, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}
	signature := ed25519.Sign(privateKey, payloadJSON)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/update/v1/manifest.json" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		_ = json.NewEncoder(w).Encode(signedManifest{
			Payload:   payloadJSON,
			Signature: base64.StdEncoding.EncodeToString(signature),
		})
	}))
	defer server.Close()

	service := NewServiceWithOptions("1.2.3", "direct", ServiceOptions{
		ManifestBaseURL: server.URL,
		PublicKeyB64:    base64.StdEncoding.EncodeToString(publicKey),
	})
	status, err := service.Check(true)
	if err != nil {
		t.Fatalf("check update: %v", err)
	}
	if !status.UpdateAvailable {
		t.Fatalf("expected update available")
	}
	if status.AvailableUpdate == nil || status.AvailableUpdate.Version != "1.2.4" {
		t.Fatalf("unexpected available update: %+v", status.AvailableUpdate)
	}
	if status.State != core.UpdateStateAvailable {
		t.Fatalf("unexpected state: %s", status.State)
	}
}

func TestCheckFailsOnInvalidSignature(t *testing.T) {
	publicKey, _, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}

	payload := manifestPayload{
		Product:     "hopter",
		Channel:     "stable",
		Version:     "1.2.4",
		PublishedAt: time.Date(2026, 4, 19, 12, 0, 0, 0, time.UTC),
		Artifacts: map[string]manifestArtifact{
			currentPlatformKey(): {
				URL:       "https://updates.hopter.dev/artifacts/1.2.4/hopter",
				SHA256:    strings.Repeat("a", 64),
				SizeBytes: 42,
			},
		},
	}
	payloadJSON, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(signedManifest{
			Payload:   payloadJSON,
			Signature: base64.StdEncoding.EncodeToString([]byte("bad-signature")),
		})
	}))
	defer server.Close()

	service := NewServiceWithOptions("1.2.3", "direct", ServiceOptions{
		ManifestURL:  server.URL,
		PublicKeyB64: base64.StdEncoding.EncodeToString(publicKey),
	})
	status, err := service.Check(true)
	if err == nil {
		t.Fatalf("expected signature verification error")
	}
	if status.UpdateAvailable {
		t.Fatalf("did not expect update available")
	}
	if status.FailureReason == "" {
		t.Fatalf("expected failure reason to be set")
	}
}

func TestCheckUsesInjectedAvailableVersion(t *testing.T) {
	service := NewServiceWithOptions("1.2.3", "homebrew_formula", ServiceOptions{
		TestAvailableUpdate: &core.AvailableUpdate{
			Version:  "1.2.4",
			NotesURL: "https://hopter.dev/releases/1.2.4",
		},
	})
	status, err := service.Check(true)
	if err != nil {
		t.Fatalf("check update: %v", err)
	}
	if status.UpdatePolicy != core.UpdatePolicyPackageManaged {
		t.Fatalf("unexpected update policy: %s", status.UpdatePolicy)
	}
	if status.UpgradeCommandHint != "brew upgrade hopter" {
		t.Fatalf("unexpected command hint: %q", status.UpgradeCommandHint)
	}
	if !status.UpdateAvailable {
		t.Fatalf("expected update available")
	}
}

func TestNPMInstallSourceIsPackageManaged(t *testing.T) {
	service := NewServiceWithOptions("1.2.3", "npm", ServiceOptions{})
	status := service.GetStatus()
	if status.InstallSource != core.InstallSourceNPM {
		t.Fatalf("unexpected install source: %s", status.InstallSource)
	}
	if status.UpdatePolicy != core.UpdatePolicyPackageManaged {
		t.Fatalf("unexpected update policy: %s", status.UpdatePolicy)
	}
	if status.UpgradeCommandHint != "npm update -g hopter-cli" {
		t.Fatalf("unexpected command hint: %q", status.UpgradeCommandHint)
	}
}

func TestCheckFallsBackToGitHubLatestRelease(t *testing.T) {
	assetName := "hopter-" + currentPlatformKey()
	checksum := strings.Repeat("b", 64)
	var baseURL string

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/repos/sorcererxw/hopter/releases/latest":
			_ = json.NewEncoder(w).Encode(githubReleaseResponse{
				TagName:     "v0.0.9",
				HTMLURL:     "https://github.com/sorcererxw/hopter/releases/tag/v0.0.9",
				PublishedAt: time.Date(2026, 4, 19, 12, 0, 0, 0, time.UTC),
				Assets: []githubReleaseAsset{
					{
						Name:               assetName,
						BrowserDownloadURL: baseURL + "/download/" + assetName,
						Size:               123,
					},
					{
						Name:               "checksums.txt",
						BrowserDownloadURL: baseURL + "/download/checksums.txt",
						Size:               456,
					},
				},
			})
		case "/download/checksums.txt":
			_, _ = w.Write([]byte(checksum + "  " + assetName + "\n"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	baseURL = server.URL

	service := NewServiceWithOptions("0.0.8", "direct", ServiceOptions{GitHubAPIBaseURL: server.URL})
	status, err := service.Check(true)
	if err != nil {
		t.Fatalf("check update: %v", err)
	}
	if !status.UpdateAvailable {
		t.Fatalf("expected update available")
	}
	if status.AvailableUpdate == nil {
		t.Fatalf("expected available update")
	}
	if status.AvailableUpdate.Version != "v0.0.9" {
		t.Fatalf("version = %q, want v0.0.9", status.AvailableUpdate.Version)
	}
	if status.AvailableUpdate.ArtifactURL != server.URL+"/download/"+assetName {
		t.Fatalf("artifact url = %q", status.AvailableUpdate.ArtifactURL)
	}
	if status.AvailableUpdate.SHA256 != checksum {
		t.Fatalf("checksum = %q, want %q", status.AvailableUpdate.SHA256, checksum)
	}
}

func TestApplyDownloadsVerifiesAndRunsDoctorPreflight(t *testing.T) {
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}

	artifactBytes := []byte("#!/bin/sh\nprintf '{\"checks\":[{\"name\":\"doctor\",\"status\":\"PASS\",\"detail\":\"ok\"}]}'\n")
	sum := sha256.Sum256(artifactBytes)
	checksum := hex.EncodeToString(sum[:])

	var payloadJSON []byte
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/update/v1/manifest.json":
			_, _ = w.Write(payloadJSON)
		case "/artifacts/hopter":
			_, _ = w.Write(artifactBytes)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	payload := manifestPayload{
		Product:     "hopter",
		Channel:     "stable",
		Version:     "1.2.4",
		PublishedAt: time.Date(2026, 4, 19, 12, 0, 0, 0, time.UTC),
		Artifacts: map[string]manifestArtifact{
			currentPlatformKey(): {
				URL:       server.URL + "/artifacts/hopter",
				SHA256:    checksum,
				SizeBytes: int64(len(artifactBytes)),
			},
		},
	}
	rawPayload, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}
	signature := ed25519.Sign(privateKey, rawPayload)
	signed, err := json.Marshal(signedManifest{
		Payload:   rawPayload,
		Signature: base64.StdEncoding.EncodeToString(signature),
	})
	if err != nil {
		t.Fatalf("marshal signed manifest: %v", err)
	}
	payloadJSON = signed

	service := NewServiceWithOptions("1.2.3", "direct", ServiceOptions{
		ManifestBaseURL: server.URL,
		PublicKeyB64:    base64.StdEncoding.EncodeToString(publicKey),
	})
	if _, err := service.Check(true); err != nil {
		t.Fatalf("check update: %v", err)
	}
	reexecCalled := make(chan string, 1)
	service.reexecDelay = 0
	service.reexec = func(path string) error {
		reexecCalled <- path
		return nil
	}

	status, err := service.Apply()
	if err != nil {
		t.Fatalf("expected apply to succeed, got %v", err)
	}
	if status.State != core.UpdateStateReexecing {
		t.Fatalf("expected reexecing after preflight, got %s", status.State)
	}
	select {
	case path := <-reexecCalled:
		if path == "" {
			t.Fatalf("expected staged binary path")
		}
	case <-time.After(2 * time.Second):
		t.Fatalf("expected reexec to be scheduled")
	}
}

func TestApplyRecordsFailureWhenReexecFails(t *testing.T) {
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}

	artifactBytes := []byte("#!/bin/sh\nprintf '{\"checks\":[{\"name\":\"doctor\",\"status\":\"PASS\",\"detail\":\"ok\"}]}'\n")
	sum := sha256.Sum256(artifactBytes)
	checksum := hex.EncodeToString(sum[:])

	var payloadJSON []byte
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/update/v1/manifest.json":
			_, _ = w.Write(payloadJSON)
		case "/artifacts/hopter":
			_, _ = w.Write(artifactBytes)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	payload := manifestPayload{
		Product:     "hopter",
		Channel:     "stable",
		Version:     "1.2.4",
		PublishedAt: time.Date(2026, 4, 19, 12, 0, 0, 0, time.UTC),
		Artifacts: map[string]manifestArtifact{
			currentPlatformKey(): {
				URL:       server.URL + "/artifacts/hopter",
				SHA256:    checksum,
				SizeBytes: int64(len(artifactBytes)),
			},
		},
	}
	rawPayload, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}
	signature := ed25519.Sign(privateKey, rawPayload)
	signed, err := json.Marshal(signedManifest{
		Payload:   rawPayload,
		Signature: base64.StdEncoding.EncodeToString(signature),
	})
	if err != nil {
		t.Fatalf("marshal signed manifest: %v", err)
	}
	payloadJSON = signed

	service := NewServiceWithOptions("1.2.3", "direct", ServiceOptions{
		ManifestBaseURL: server.URL,
		PublicKeyB64:    base64.StdEncoding.EncodeToString(publicKey),
	})
	if _, err := service.Check(true); err != nil {
		t.Fatalf("check update: %v", err)
	}
	service.reexecDelay = 0
	service.reexec = func(path string) error {
		return errors.New("boom")
	}

	status, err := service.Apply()
	if err != nil {
		t.Fatalf("expected apply to succeed, got %v", err)
	}
	if status.State != core.UpdateStateReexecing {
		t.Fatalf("expected reexecing after preflight, got %s", status.State)
	}

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		final := service.GetStatus()
		if final.State == core.UpdateStateFailedPreExec {
			if final.FailureReason != "boom" {
				t.Fatalf("unexpected failure reason: %q", final.FailureReason)
			}
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("expected failed_pre_exec after reexec failure")
}

func TestIsVersionGreater(t *testing.T) {
	tests := []struct {
		candidate string
		current   string
		expected  bool
	}{
		{"1.2.4", "1.2.3", true},
		{"1.3.0", "1.2.9", true},
		{"1.2.3", "1.2.3", false},
		{"1.2.2", "1.2.3", false},
		{"v1.2.4", "1.2.3", true},
	}

	for _, tc := range tests {
		if got := isVersionGreater(tc.candidate, tc.current); got != tc.expected {
			t.Fatalf("isVersionGreater(%q, %q) = %v, want %v", tc.candidate, tc.current, got, tc.expected)
		}
	}
}
