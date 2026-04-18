package terminal

import "sync"

type InMemoryStore struct {
	mu    sync.RWMutex
	byID  map[string]Session
	byKey map[SessionKey]string
}

func NewInMemoryStore() *InMemoryStore {
	return &InMemoryStore{
		byID:  make(map[string]Session),
		byKey: make(map[SessionKey]string),
	}
}

func (s *InMemoryStore) Upsert(session Session) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.byID[session.ID] = session
	s.byKey[session.Key()] = session.ID
}

func (s *InMemoryStore) GetByID(terminalID string) (Session, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	session, ok := s.byID[terminalID]
	return session, ok
}

func (s *InMemoryStore) GetByKey(key SessionKey) (Session, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	id, ok := s.byKey[key]
	if !ok {
		return Session{}, false
	}
	session, ok := s.byID[id]
	return session, ok
}

func (s *InMemoryStore) Delete(terminalID string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	session, ok := s.byID[terminalID]
	if !ok {
		return
	}
	delete(s.byID, terminalID)
	delete(s.byKey, session.Key())
}

func (s *InMemoryStore) ListByBrowserTab(browserInstanceID, tabID string) []Session {
	s.mu.RLock()
	defer s.mu.RUnlock()

	result := make([]Session, 0)
	for _, session := range s.byID {
		if session.BrowserInstanceID == browserInstanceID && session.TabID == tabID {
			result = append(result, session)
		}
	}
	return result
}
