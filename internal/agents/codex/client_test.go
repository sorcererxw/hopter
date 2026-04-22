package codex

import (
	"encoding/json"
	"testing"
)

func TestTraceLineClassifiesAppServerRequestWithoutJSONRPC(t *testing.T) {
	var traces []TraceEntry
	transport := &tracedTransport{
		onTrace: func(entry TraceEntry) {
			traces = append(traces, entry)
		},
	}

	transport.traceLine("outgoing", `{"id":7,"method":"thread/start","params":{"approvalPolicy":"on-request"}}`)

	if len(traces) != 1 {
		t.Fatalf("trace count = %d, want 1", len(traces))
	}
	if traces[0].Kind != "request" || traces[0].Method != "thread/start" || traces[0].ID != "7" {
		t.Fatalf("trace = %#v, want outgoing thread/start request", traces[0])
	}
	var payload map[string]any
	if err := json.Unmarshal(traces[0].Payload, &payload); err != nil {
		t.Fatalf("decode trace payload: %v", err)
	}
	if _, ok := payload["jsonrpc"]; ok {
		t.Fatalf("payload included jsonrpc field: %s", traces[0].Payload)
	}
}

func TestTraceLineClassifiesInitializedNotification(t *testing.T) {
	var traces []TraceEntry
	transport := &tracedTransport{
		onTrace: func(entry TraceEntry) {
			traces = append(traces, entry)
		},
	}

	transport.traceLine("outgoing", `{"method":"initialized"}`)

	if len(traces) != 1 {
		t.Fatalf("trace count = %d, want 1", len(traces))
	}
	if traces[0].Kind != "notification" || traces[0].Method != "initialized" {
		t.Fatalf("trace = %#v, want initialized notification", traces[0])
	}
}

func TestTraceLineCapturesServerRequestWireID(t *testing.T) {
	var gotMethod string
	var gotID json.RawMessage
	var gotParams json.RawMessage
	transport := &tracedTransport{
		onServerRequest: func(method string, id json.RawMessage, params json.RawMessage) {
			gotMethod = method
			gotID = append(json.RawMessage(nil), id...)
			gotParams = append(json.RawMessage(nil), params...)
		},
	}

	transport.traceLine("incoming", `{"id":"approval-1","method":"item/fileChange/requestApproval","params":{"itemId":"item-1"}}`)

	if gotMethod != "item/fileChange/requestApproval" {
		t.Fatalf("method = %q", gotMethod)
	}
	if string(gotID) != `"approval-1"` {
		t.Fatalf("id = %s", gotID)
	}
	if string(gotParams) != `{"itemId":"item-1"}` {
		t.Fatalf("params = %s", gotParams)
	}
}
