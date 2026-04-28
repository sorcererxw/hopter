package serverhttp

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/sorcererxw/hopter/internal/relaycontract"
)

func TestRelayRequestVerifierAcceptsSignedRequestOnce(t *testing.T) {
	verifier := NewRelayRequestVerifier()
	verifier.Update(RelayVerificationSession{
		AuthUserID:        "user-1",
		WorkspaceSlug:     "alice",
		LeaseID:           "lease-1",
		LeaseVersion:      1,
		RouteGeneration:   3,
		RequestSigningKey: "request-signing-key",
	})

	request := signedRelayRequest(t, "request-signing-key", relaycontract.RelayRequestContext{
		AuthUserId:      "user-1",
		WorkspaceSlug:   "alice",
		LeaseId:         "lease-1",
		LeaseVersion:    1,
		RouteGeneration: 3,
		Exp:             time.Now().Add(time.Minute).Unix(),
		Nonce:           "nonce-1",
	})

	if err := verifier.VerifyRequest(request); err != nil {
		t.Fatalf("verify request: %v", err)
	}
}

func TestRelayRequestVerifierRejectsReplay(t *testing.T) {
	verifier := NewRelayRequestVerifier()
	verifier.Update(RelayVerificationSession{
		AuthUserID:        "user-1",
		WorkspaceSlug:     "alice",
		LeaseID:           "lease-1",
		LeaseVersion:      1,
		RouteGeneration:   3,
		RequestSigningKey: "request-signing-key",
	})

	request := signedRelayRequest(t, "request-signing-key", relaycontract.RelayRequestContext{
		AuthUserId:      "user-1",
		WorkspaceSlug:   "alice",
		LeaseId:         "lease-1",
		LeaseVersion:    1,
		RouteGeneration: 3,
		Exp:             time.Now().Add(time.Minute).Unix(),
		Nonce:           "nonce-1",
	})

	if err := verifier.VerifyRequest(request); err != nil {
		t.Fatalf("first verify request: %v", err)
	}
	if err := verifier.VerifyRequest(request); err == nil {
		t.Fatal("expected replayed request to be rejected")
	}
}

func signedRelayRequest(t *testing.T, signingKey string, context relaycontract.RelayRequestContext) *http.Request {
	t.Helper()

	payloadJSON, err := json.Marshal(context)
	if err != nil {
		t.Fatalf("marshal context: %v", err)
	}
	payload := base64.RawURLEncoding.EncodeToString(payloadJSON)
	mac := hmac.New(sha256.New, []byte(signingKey))
	_, _ = mac.Write([]byte(payload))
	signature := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))

	request := httptest.NewRequest("GET", "http://127.0.0.1/events", nil)
	request.Header.Set(relaycontract.RelayRequestContextPayloadHeader, payload)
	request.Header.Set(relaycontract.RelayRequestContextSignatureHeader, signature)
	return request
}
