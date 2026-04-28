package serverhttp

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"sync"
	"time"

	"github.com/sorcererxw/hopter/internal/relaycontract"
)

var errRelayRequestContextMissing = errors.New("relay request context missing")

type relayVerifiedRequestKey struct{}

type RelayVerificationSession struct {
	AuthUserID       string
	WorkspaceSlug    string
	LeaseID          string
	LeaseVersion     int
	RouteGeneration  int
	RequestSigningKey string
}

type RelayRequestVerifier struct {
	mu            sync.RWMutex
	current       RelayVerificationSession
	hasCurrent    bool
	usedNonces    map[string]time.Time
}

func NewRelayRequestVerifier() *RelayRequestVerifier {
	return &RelayRequestVerifier{
		usedNonces: make(map[string]time.Time),
	}
}

func (v *RelayRequestVerifier) Update(session RelayVerificationSession) {
	v.mu.Lock()
	defer v.mu.Unlock()
	v.current = session
	v.hasCurrent = true
}

func (v *RelayRequestVerifier) Clear() {
	v.mu.Lock()
	defer v.mu.Unlock()
	v.current = RelayVerificationSession{}
	v.hasCurrent = false
	v.usedNonces = make(map[string]time.Time)
}

func (v *RelayRequestVerifier) VerifyRequest(r *http.Request) error {
	payload := r.Header.Get(relaycontract.RelayRequestContextPayloadHeader)
	signature := r.Header.Get(relaycontract.RelayRequestContextSignatureHeader)
	if payload == "" && signature == "" {
		return errRelayRequestContextMissing
	}
	if payload == "" || signature == "" {
		return errors.New("relay request context is incomplete")
	}

	v.mu.Lock()
	defer v.mu.Unlock()

	if !v.hasCurrent || v.current.RequestSigningKey == "" {
		return errors.New("relay request signing key is unavailable")
	}

	if !verifyRelaySignature(v.current.RequestSigningKey, payload, signature) {
		return errors.New("relay request signature is invalid")
	}

	var decoded relaycontract.RelayRequestContext
	if err := decodeRelayPayload(payload, &decoded); err != nil {
		return err
	}

	now := time.Now().UTC()
	if now.Unix() >= decoded.Exp {
		return errors.New("relay request context expired")
	}
	if decoded.AuthUserId != v.current.AuthUserID ||
		decoded.WorkspaceSlug != v.current.WorkspaceSlug ||
		decoded.LeaseId != v.current.LeaseID ||
		int(decoded.LeaseVersion) != v.current.LeaseVersion ||
		int(decoded.RouteGeneration) != v.current.RouteGeneration {
		return errors.New("relay request context does not match the active session")
	}

	v.pruneNoncesLocked(now)
	if _, exists := v.usedNonces[decoded.Nonce]; exists {
		return errors.New("relay request context nonce already used")
	}
	v.usedNonces[decoded.Nonce] = time.Unix(decoded.Exp, 0).UTC()

	return nil
}

func WithVerifiedRelayRequest(r *http.Request) *http.Request {
	return r.WithContext(context.WithValue(r.Context(), relayVerifiedRequestKey{}, true))
}

func IsVerifiedRelayRequest(r *http.Request) bool {
	value, _ := r.Context().Value(relayVerifiedRequestKey{}).(bool)
	return value
}

func (v *RelayRequestVerifier) pruneNoncesLocked(now time.Time) {
	for nonce, expiresAt := range v.usedNonces {
		if !now.Before(expiresAt) {
			delete(v.usedNonces, nonce)
		}
	}
}

func verifyRelaySignature(secret string, payload string, signature string) bool {
	expectedMac := hmac.New(sha256.New, []byte(secret))
	_, _ = expectedMac.Write([]byte(payload))
	expected := base64.RawURLEncoding.EncodeToString(expectedMac.Sum(nil))
	return hmac.Equal([]byte(expected), []byte(signature))
}

func decodeRelayPayload(payload string, target any) error {
	data, err := base64.RawURLEncoding.DecodeString(payload)
	if err != nil {
		return err
	}
	return json.Unmarshal(data, target)
}
