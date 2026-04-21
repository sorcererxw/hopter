package codex

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"

	"golang.org/x/sync/singleflight"

	"github.com/sorcererxw/hopter/internal/core"
)

const (
	defaultTranscriptPageSize = 50
	maxSessionCacheBytes      = 32 << 20
	maxCacheEntryBytes        = 1 << 20
	lazyCursorPrefix          = "lazy:"
)

type sessionReadFallback interface {
	GetSession(sessionID string) (core.Session, core.Project, error)
}

type SessionReadModel struct {
	workspace core.WorkspaceService
	manager   *Manager
	fallback  sessionReadFallback

	metaCache *boundedLRU
	pageCache *boundedLRU
	group     singleflight.Group
}

type transcriptCursor struct {
	SnapshotUnixMilli int64 `json:"snapshotUnixMilli"`
	BeforeIndex       int   `json:"beforeIndex"`
}

func NewSessionReadModel(
	workspace core.WorkspaceService,
	manager *Manager,
	fallback sessionReadFallback,
) *SessionReadModel {
	return &SessionReadModel{
		workspace: workspace,
		manager:   manager,
		fallback:  fallback,
		metaCache: newBoundedLRU(maxSessionCacheBytes / 8),
		pageCache: newBoundedLRU(maxSessionCacheBytes),
	}
}

func (m *SessionReadModel) GetSessionMeta(sessionID string) (core.SessionMeta, error) {
	session, project, err := m.readSessionMeta(sessionID)
	if err != nil {
		return core.SessionMeta{}, err
	}

	meta := core.SessionMeta{
		Session:            cloneSessionForMeta(session),
		Project:            project,
		LatestPageSizeHint: defaultTranscriptPageSize,
	}
	if page, ok := m.getCachedPage(session.ID, session.UpdatedAt, "", defaultTranscriptPageSize); ok {
		meta.HasMoreBefore = page.HasMoreBefore
		meta.LatestPageSizeHint = uint32(len(page.Items))
	}

	m.metaCache.Set(metaCacheKey(session.ID), meta, estimateSessionMetaSize(meta))
	return meta, nil
}

func (m *SessionReadModel) ListSessionTranscript(input core.ListSessionTranscriptInput) (core.SessionTranscriptPage, error) {
	limit := normalizeTranscriptPageSize(input.Limit)
	meta, err := m.GetSessionMeta(input.SessionID)
	if err != nil {
		return core.SessionTranscriptPage{}, err
	}

	beforeCursor := input.BeforeCursor
	if strings.TrimSpace(beforeCursor) == "" {
		if page, ok := m.getCachedPage(meta.Session.ID, meta.Session.UpdatedAt, "", limit); ok {
			return page, nil
		}
		page, err := m.loadLatestTranscriptPage(meta, limit)
		if err != nil {
			return core.SessionTranscriptPage{}, err
		}
		m.cacheTranscriptPage(meta.Session.ID, meta.Session.UpdatedAt, "", limit, page)
		return page, nil
	}

	if lazy, ok := decodeLazyTranscriptCursor(beforeCursor); ok {
		if lazy.SnapshotUnixMilli != snapshotUnixMilli(meta.Session.UpdatedAt) {
			beforeCursor = ""
		} else {
			pages, err := m.loadAndCacheTranscriptPages(meta, limit)
			if err != nil {
				return core.SessionTranscriptPage{}, err
			}
			latest := pages[""]
			if latest.NextBeforeCursor == "" {
				return core.SessionTranscriptPage{
					SessionID:         meta.Session.ID,
					ProjectID:         meta.Project.ID,
					Items:             nil,
					HasMoreBefore:     false,
					SnapshotUpdatedAt: meta.Session.UpdatedAt,
				}, nil
			}
			if page, ok := pages[latest.NextBeforeCursor]; ok {
				m.cacheTranscriptPage(meta.Session.ID, meta.Session.UpdatedAt, beforeCursor, limit, page)
				return page, nil
			}
			return core.SessionTranscriptPage{}, fmt.Errorf("transcript page for session %q lazy cursor not found", meta.Session.ID)
		}
	}
	if cursor, ok := decodeTranscriptCursor(beforeCursor); ok && cursor.SnapshotUnixMilli != snapshotUnixMilli(meta.Session.UpdatedAt) {
		beforeCursor = ""
	}

	if page, ok := m.getCachedPage(meta.Session.ID, meta.Session.UpdatedAt, beforeCursor, limit); ok {
		return page, nil
	}

	groupKey := fmt.Sprintf("transcript-pages:%s:%d:%d", meta.Session.ID, snapshotUnixMilli(meta.Session.UpdatedAt), limit)
	_, err, _ = m.group.Do(groupKey, func() (any, error) {
		_, err := m.loadAndCacheTranscriptPages(meta, limit)
		return nil, err
	})
	if err != nil {
		return core.SessionTranscriptPage{}, err
	}

	if page, ok := m.getCachedPage(meta.Session.ID, meta.Session.UpdatedAt, beforeCursor, limit); ok {
		return page, nil
	}

	return core.SessionTranscriptPage{}, fmt.Errorf("transcript page for session %q not found", meta.Session.ID)
}

func (m *SessionReadModel) loadLatestTranscriptPage(meta core.SessionMeta, limit uint32) (core.SessionTranscriptPage, error) {
	limit = normalizeTranscriptPageSize(limit)
	if isLocalOnlySession(meta.Session) {
		items := normalizeTranscriptItemsForPage(meta.Session.TranscriptItems)
		pages := buildTranscriptPages(meta.Session.ID, meta.Project.ID, meta.Session.UpdatedAt, items, limit)
		return pages[""], nil
	}
	if strings.TrimSpace(meta.Session.BackendKey) != "" && strings.ToLower(meta.Session.BackendKey) != "codex" {
		session, project, err := m.fallback.GetSession(meta.Session.ID)
		if err != nil {
			return core.SessionTranscriptPage{}, err
		}
		items := normalizeTranscriptItemsForPage(session.TranscriptItems)
		pages := buildTranscriptPages(meta.Session.ID, project.ID, meta.Session.UpdatedAt, items, limit)
		return pages[""], nil
	}

	read, err := m.readCodexTranscript(meta.Session.ID, meta.Project, meta.Session.BackendThreadID)
	if err != nil {
		return core.SessionTranscriptPage{}, err
	}
	items, hasMoreBefore := normalizeLatestReadThreadItemsForPage(read, int(limit))
	page := core.SessionTranscriptPage{
		SessionID:         meta.Session.ID,
		ProjectID:         meta.Project.ID,
		Items:             items,
		HasMoreBefore:     hasMoreBefore,
		SnapshotUpdatedAt: meta.Session.UpdatedAt,
	}
	if hasMoreBefore {
		page.NextBeforeCursor = encodeLazyTranscriptCursor(transcriptCursor{
			SnapshotUnixMilli: snapshotUnixMilli(meta.Session.UpdatedAt),
			BeforeIndex:       -1,
		})
	}
	return page, nil
}

func (m *SessionReadModel) loadAndCacheTranscriptPages(meta core.SessionMeta, limit uint32) (map[string]core.SessionTranscriptPage, error) {
	if isLocalOnlySession(meta.Session) {
		return m.cacheTranscriptPages(meta, normalizeTranscriptItemsForPage(meta.Session.TranscriptItems), limit), nil
	}
	if strings.TrimSpace(meta.Session.BackendKey) != "" && strings.ToLower(meta.Session.BackendKey) != "codex" {
		session, project, err := m.fallback.GetSession(meta.Session.ID)
		if err != nil {
			return nil, err
		}
		meta.Project = project
		meta.Session = cloneSessionForMeta(session)
		return m.cacheTranscriptPages(meta, normalizeTranscriptItemsForPage(session.TranscriptItems), limit), nil
	}

	items, err := m.readCodexTranscriptItems(meta.Session.ID, meta.Project, meta.Session.BackendThreadID)
	if err != nil {
		return nil, err
	}
	return m.cacheTranscriptPages(meta, items, limit), nil
}

func (m *SessionReadModel) cacheTranscriptPages(meta core.SessionMeta, items []core.SessionTranscriptItem, limit uint32) map[string]core.SessionTranscriptPage {
	limit = normalizeTranscriptPageSize(limit)
	pages := buildTranscriptPages(meta.Session.ID, meta.Project.ID, meta.Session.UpdatedAt, items, limit)
	for requestCursor, page := range pages {
		m.cacheTranscriptPage(meta.Session.ID, meta.Session.UpdatedAt, requestCursor, limit, page)
	}
	return pages
}

func (m *SessionReadModel) readSessionMeta(sessionID string) (core.Session, core.Project, error) {
	local, hasLocal := m.workspace.GetSession(sessionID)
	if hasLocal {
		project, ok := m.workspace.GetProject(local.ProjectID)
		if !ok {
			return core.Session{}, core.Project{}, fmt.Errorf("project %q not found for session", local.ProjectID)
		}
		if isLocalOnlySession(local) {
			return local, project, nil
		}
		if backendKey := strings.ToLower(strings.TrimSpace(local.BackendKey)); backendKey != "" && backendKey != "codex" {
			return m.fallback.GetSession(sessionID)
		}
		return m.readCodexMeta(sessionID, local.BackendThreadID, project, local, true)
	}

	if session, project, err := m.readCodexMeta(sessionID, sessionID, core.Project{}, core.Session{}, false); err == nil {
		return session, project, nil
	}
	if m.fallback != nil {
		return m.fallback.GetSession(sessionID)
	}
	return core.Session{}, core.Project{}, fmt.Errorf("session %q not found", sessionID)
}

func (m *SessionReadModel) readCodexMeta(
	sessionID string,
	threadID string,
	project core.Project,
	local core.Session,
	hasLocal bool,
) (core.Session, core.Project, error) {
	threadID = strings.TrimSpace(threadID)
	if threadID == "" {
		return local, project, nil
	}

	if live := m.manager.liveSession(sessionID); live != nil && live.thread == threadID {
		read, err := live.client.ReadThreadMeta(threadID)
		if err != nil {
			return core.Session{}, core.Project{}, err
		}
		thread := threadRecordFromRead(read)
		if !hasLocal {
			project = projectForThreadOrSynthetic(m.workspace.ListProjects(), thread)
		}
		session := sessionFromThread(thread, project, local, hasLocal)
		session.BackendThreadID = threadID
		return session, project, nil
	}

	cwd := "."
	if hasLocal {
		cwd = project.RootPath
	} else {
		projects := m.workspace.ListProjects()
		if session, ok := m.manager.sessionByThreadID(threadID); ok {
			if candidate, ok := m.workspace.GetProject(session.ProjectID); ok {
				project = candidate
				cwd = candidate.RootPath
				local = session
				hasLocal = true
			}
		} else if len(projects) > 0 {
			cwd = projects[0].RootPath
		}
	}

	client, err := m.manager.start(context.Background(), cwd, nil, nil, nil, nil)
	if err != nil {
		return core.Session{}, core.Project{}, err
	}
	defer client.Close()

	read, err := client.ReadThreadMeta(threadID)
	if err != nil {
		return core.Session{}, core.Project{}, err
	}
	thread := threadRecordFromRead(read)
	if !hasLocal {
		project = projectForThreadOrSynthetic(m.workspace.ListProjects(), thread)
	}
	session := sessionFromThread(thread, project, local, hasLocal)
	session.BackendThreadID = threadID
	return session, project, nil
}

func (m *SessionReadModel) readCodexTranscriptItems(sessionID string, project core.Project, threadID string) ([]core.SessionTranscriptItem, error) {
	read, err := m.readCodexTranscript(sessionID, project, threadID)
	if err != nil {
		return nil, err
	}
	return normalizeReadThreadItemsForPage(read), nil
}

func (m *SessionReadModel) readCodexTranscript(sessionID string, project core.Project, threadID string) (*ReadThreadResult, error) {
	threadID = strings.TrimSpace(threadID)
	if threadID == "" {
		return nil, fmt.Errorf("session %q is missing backend thread id", sessionID)
	}

	if live := m.manager.liveSession(sessionID); live != nil && live.thread == threadID {
		read, err := live.client.ReadThread(threadID)
		if err != nil {
			return nil, err
		}
		return read, nil
	}

	client, err := m.manager.start(context.Background(), project.RootPath, nil, nil, nil, nil)
	if err != nil {
		return nil, err
	}
	defer client.Close()

	read, err := client.ReadThread(threadID)
	if err != nil {
		return nil, err
	}
	return read, nil
}

func (m *SessionReadModel) getCachedPage(sessionID string, updatedAt time.Time, beforeCursor string, limit uint32) (core.SessionTranscriptPage, bool) {
	value, ok := m.pageCache.Get(pageCacheKey(sessionID, updatedAt, beforeCursor, limit))
	if !ok {
		return core.SessionTranscriptPage{}, false
	}
	page, ok := value.(core.SessionTranscriptPage)
	if !ok {
		return core.SessionTranscriptPage{}, false
	}
	return cloneTranscriptPage(page), true
}

func normalizeTranscriptPageSize(limit uint32) uint32 {
	switch {
	case limit == 0:
		return defaultTranscriptPageSize
	case limit > 100:
		return 100
	default:
		return limit
	}
}

func buildTranscriptPages(
	sessionID string,
	projectID string,
	snapshot time.Time,
	items []core.SessionTranscriptItem,
	limit uint32,
) map[string]core.SessionTranscriptPage {
	pageSize := int(normalizeTranscriptPageSize(limit))
	if pageSize <= 0 {
		pageSize = defaultTranscriptPageSize
	}

	pages := make(map[string]core.SessionTranscriptPage)
	end := len(items)
	requestCursor := ""
	for {
		start := end - pageSize
		if start < 0 {
			start = 0
		}
		pageItems := append([]core.SessionTranscriptItem(nil), items[start:end]...)
		hasMoreBefore := start > 0
		nextBeforeCursor := ""
		if hasMoreBefore {
			nextBeforeCursor = encodeTranscriptCursor(transcriptCursor{
				SnapshotUnixMilli: snapshotUnixMilli(snapshot),
				BeforeIndex:       start,
			})
		}
		pages[requestCursor] = core.SessionTranscriptPage{
			SessionID:         sessionID,
			ProjectID:         projectID,
			Items:             pageItems,
			NextBeforeCursor:  nextBeforeCursor,
			HasMoreBefore:     hasMoreBefore,
			SnapshotUpdatedAt: snapshot,
		}
		if !hasMoreBefore {
			break
		}
		end = start
		requestCursor = nextBeforeCursor
	}
	return pages
}

func metaCacheKey(sessionID string) string {
	return "meta:" + strings.TrimSpace(sessionID)
}

func pageCacheKey(sessionID string, snapshot time.Time, beforeCursor string, limit uint32) string {
	return strings.Join([]string{
		"page",
		strings.TrimSpace(sessionID),
		strconv.FormatInt(snapshotUnixMilli(snapshot), 10),
		strconv.FormatUint(uint64(normalizeTranscriptPageSize(limit)), 10),
		beforeCursor,
	}, ":")
}

func snapshotUnixMilli(t time.Time) int64 {
	return t.UTC().UnixMilli()
}

func encodeTranscriptCursor(cursor transcriptCursor) string {
	raw, err := json.Marshal(cursor)
	if err != nil {
		return ""
	}
	return base64.RawURLEncoding.EncodeToString(raw)
}

func decodeTranscriptCursor(value string) (transcriptCursor, bool) {
	if strings.TrimSpace(value) == "" {
		return transcriptCursor{}, false
	}
	raw, err := base64.RawURLEncoding.DecodeString(value)
	if err != nil {
		return transcriptCursor{}, false
	}
	var cursor transcriptCursor
	if err := json.Unmarshal(raw, &cursor); err != nil {
		return transcriptCursor{}, false
	}
	if cursor.BeforeIndex < 0 {
		return transcriptCursor{}, false
	}
	return cursor, true
}

func encodeLazyTranscriptCursor(cursor transcriptCursor) string {
	raw, err := json.Marshal(cursor)
	if err != nil {
		return ""
	}
	return lazyCursorPrefix + base64.RawURLEncoding.EncodeToString(raw)
}

func decodeLazyTranscriptCursor(value string) (transcriptCursor, bool) {
	if !strings.HasPrefix(value, lazyCursorPrefix) {
		return transcriptCursor{}, false
	}
	raw, err := base64.RawURLEncoding.DecodeString(strings.TrimPrefix(value, lazyCursorPrefix))
	if err != nil {
		return transcriptCursor{}, false
	}
	var cursor transcriptCursor
	if err := json.Unmarshal(raw, &cursor); err != nil {
		return transcriptCursor{}, false
	}
	return cursor, true
}

func threadRecordFromRead(read *ReadThreadResult) ThreadRecord {
	if read == nil {
		return ThreadRecord{}
	}
	return ThreadRecord{
		ID:            read.Thread.ID,
		ForkedFromID:  read.Thread.ForkedFromID,
		Preview:       read.Thread.Preview,
		Ephemeral:     read.Thread.Ephemeral,
		ModelProvider: read.Thread.ModelProvider,
		CreatedAt:     read.Thread.CreatedAt,
		UpdatedAt:     read.Thread.UpdatedAt,
		Status:        read.Thread.Status,
		Path:          read.Thread.Path,
		Cwd:           read.Thread.Cwd,
		CLIVersion:    read.Thread.CLIVersion,
		Name:          read.Thread.Name,
	}
}

func isLocalOnlySession(session core.Session) bool {
	return strings.TrimSpace(session.BackendThreadID) == ""
}

func cloneSessionForMeta(session core.Session) core.Session {
	cloned := session
	cloned.TranscriptItems = nil
	cloned.Artifacts = append([]core.Artifact(nil), session.Artifacts...)
	return cloned
}

func cloneTranscriptPage(page core.SessionTranscriptPage) core.SessionTranscriptPage {
	page.Items = append([]core.SessionTranscriptItem(nil), page.Items...)
	return page
}

func estimateSessionMetaSize(meta core.SessionMeta) int64 {
	size := int64(128)
	size += int64(len(meta.Session.ID) + len(meta.Session.Title) + len(meta.Session.BackendKey))
	size += int64(len(meta.Session.Summary) + len(meta.Session.AttentionReason) + len(meta.Session.LastInputHint))
	size += int64(len(meta.Project.ID) + len(meta.Project.Name) + len(meta.Project.RootPath))
	for _, artifact := range meta.Session.Artifacts {
		size += int64(len(artifact.ID) + len(artifact.Label) + len(artifact.DownloadURL) + len(artifact.ContentType) + 32)
	}
	return size
}

func estimateTranscriptPageSize(page core.SessionTranscriptPage) int64 {
	size := int64(128 + len(page.SessionID) + len(page.ProjectID) + len(page.NextBeforeCursor))
	for _, item := range page.Items {
		size += int64(len(item.ID) + len(item.Title) + len(item.Body) + len(item.Status) + 48)
	}
	return size
}

func (m *SessionReadModel) cacheTranscriptPage(sessionID string, snapshot time.Time, requestCursor string, limit uint32, page core.SessionTranscriptPage) {
	size := estimateTranscriptPageSize(page)
	if size > maxCacheEntryBytes {
		return
	}
	m.pageCache.Set(pageCacheKey(sessionID, snapshot, requestCursor, limit), cloneTranscriptPage(page), size)
}
