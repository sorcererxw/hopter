package update

import (
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

type signedManifest struct {
	Payload   json.RawMessage `json:"payload"`
	Signature string          `json:"signature"`
}

type manifestPayload struct {
	Product              string                      `json:"product"`
	Channel              string                      `json:"channel"`
	Version              string                      `json:"version"`
	PublishedAt          time.Time                   `json:"published_at"`
	NotesURL             string                      `json:"notes_url"`
	MinUpgradableVersion string                      `json:"min_upgradable_version"`
	Artifacts            map[string]manifestArtifact `json:"artifacts"`
}

type manifestArtifact struct {
	URL       string `json:"url"`
	SHA256    string `json:"sha256"`
	SizeBytes int64  `json:"size_bytes"`
}

func fetchManifest(ctx context.Context, client *http.Client, url string, publicKeyB64 string) (manifestPayload, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return manifestPayload{}, fmt.Errorf("build manifest request: %w", err)
	}

	resp, err := client.Do(req)
	if err != nil {
		return manifestPayload{}, fmt.Errorf("fetch manifest: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return manifestPayload{}, fmt.Errorf("fetch manifest: status %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return manifestPayload{}, fmt.Errorf("read manifest body: %w", err)
	}

	var manifest signedManifest
	if err := json.Unmarshal(body, &manifest); err != nil {
		return manifestPayload{}, fmt.Errorf("decode signed manifest: %w", err)
	}
	if len(manifest.Payload) == 0 {
		return manifestPayload{}, fmt.Errorf("manifest payload is empty")
	}
	if strings.TrimSpace(manifest.Signature) == "" {
		return manifestPayload{}, fmt.Errorf("manifest signature is empty")
	}

	publicKey, err := loadManifestPublicKey(publicKeyB64)
	if err != nil {
		return manifestPayload{}, err
	}
	if err := verifyManifest(manifest, publicKey); err != nil {
		return manifestPayload{}, err
	}

	var payload manifestPayload
	if err := json.Unmarshal(manifest.Payload, &payload); err != nil {
		return manifestPayload{}, fmt.Errorf("decode manifest payload: %w", err)
	}
	return payload, nil
}

func loadManifestPublicKey(publicKeyB64 string) (ed25519.PublicKey, error) {
	encoded := strings.TrimSpace(strings.Trim(publicKeyB64, `"`))
	if encoded == "" {
		return nil, fmt.Errorf("update public key is required for signed manifest verification")
	}

	keyBytes, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		keyBytes, err = base64.RawStdEncoding.DecodeString(encoded)
		if err != nil {
			return nil, fmt.Errorf("decode update public key: %w", err)
		}
	}
	if len(keyBytes) != ed25519.PublicKeySize {
		return nil, fmt.Errorf("update public key must be %d bytes, got %d", ed25519.PublicKeySize, len(keyBytes))
	}
	return ed25519.PublicKey(keyBytes), nil
}

func verifyManifest(manifest signedManifest, publicKey ed25519.PublicKey) error {
	sig := strings.TrimSpace(manifest.Signature)
	signature, err := base64.StdEncoding.DecodeString(sig)
	if err != nil {
		signature, err = base64.RawStdEncoding.DecodeString(sig)
		if err != nil {
			return fmt.Errorf("decode manifest signature: %w", err)
		}
	}

	if !ed25519.Verify(publicKey, manifest.Payload, signature) {
		return fmt.Errorf("manifest signature verification failed")
	}
	return nil
}
