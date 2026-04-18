package terminal

import "testing"

func TestInMemoryStoreIndexesByIDAndKey(t *testing.T) {
	store := NewInMemoryStore()
	session := Session{
		ID:                "term_1",
		ProjectID:         "proj_1",
		SessionID:         "sess_1",
		BrowserInstanceID: "browser_1",
		TabID:             "tab_1",
	}

	store.Upsert(session)

	if got, ok := store.GetByID("term_1"); !ok || got.SessionID != "sess_1" {
		t.Fatalf("GetByID = (%+v, %v), want session sess_1", got, ok)
	}
	if got, ok := store.GetByKey(session.Key()); !ok || got.ID != "term_1" {
		t.Fatalf("GetByKey = (%+v, %v), want terminal term_1", got, ok)
	}

	store.Delete("term_1")
	if _, ok := store.GetByID("term_1"); ok {
		t.Fatalf("GetByID after delete = found, want missing")
	}
	if _, ok := store.GetByKey(session.Key()); ok {
		t.Fatalf("GetByKey after delete = found, want missing")
	}
}
