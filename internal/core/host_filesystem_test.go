package core

import (
	"os"
	"path/filepath"
	"testing"
)

func TestListDirectoryHidesDotEntriesAndFlagsRepos(t *testing.T) {
	root := t.TempDir()
	repoDir := filepath.Join(root, "demo-repo")
	childDir := filepath.Join(root, "notes")

	if err := os.MkdirAll(filepath.Join(repoDir, ".git"), 0o755); err != nil {
		t.Fatalf("mkdir repo .git: %v", err)
	}
	if err := os.MkdirAll(childDir, 0o755); err != nil {
		t.Fatalf("mkdir child dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(root, ".hidden"), []byte("x"), 0o644); err != nil {
		t.Fatalf("write hidden file: %v", err)
	}

	listing, err := listDirectory(root)
	if err != nil {
		t.Fatalf("listDirectory: %v", err)
	}

	if got := len(listing.Entries); got != 2 {
		t.Fatalf("expected 2 visible entries, got %d", got)
	}
	if listing.Entries[0].Name != "demo-repo" || !listing.Entries[0].IsRepo {
		t.Fatalf("expected first entry to be detected repo, got %+v", listing.Entries[0])
	}
	if listing.Entries[1].Name != "notes" || listing.Entries[1].IsRepo {
		t.Fatalf("expected second entry to be non-repo dir, got %+v", listing.Entries[1])
	}
}

func TestValidateProjectRootRejectsNonRepoDirectories(t *testing.T) {
	root := t.TempDir()
	if _, err := validateProjectRoot(root); err == nil {
		t.Fatalf("expected non-repo directory to be rejected")
	}
}

func TestCreateProjectCanonicalizesAndDeduplicatesRootPath(t *testing.T) {
	root := t.TempDir()
	repoDir := filepath.Join(root, "orchd")
	if err := os.MkdirAll(filepath.Join(repoDir, ".git"), 0o755); err != nil {
		t.Fatalf("mkdir repo .git: %v", err)
	}

	workspace := NewInMemoryWorkspace("test-host", nil)
	project, err := workspace.CreateProject(CreateProjectInput{
		Name:           "",
		RootPath:       filepath.Join(repoDir, "."),
		DefaultBackend: "",
	})
	if err != nil {
		t.Fatalf("CreateProject: %v", err)
	}

	canonicalRepoDir, err := filepath.EvalSymlinks(repoDir)
	if err != nil {
		t.Fatalf("EvalSymlinks: %v", err)
	}
	if project.RootPath != canonicalRepoDir {
		t.Fatalf("expected canonical repo path %q, got %q", canonicalRepoDir, project.RootPath)
	}
	if project.Name != "orchd" {
		t.Fatalf("expected basename default name, got %q", project.Name)
	}
	if project.DefaultBackend != "codex" {
		t.Fatalf("expected default backend codex, got %q", project.DefaultBackend)
	}

	if _, err := workspace.CreateProject(CreateProjectInput{
		Name:           "Duplicate",
		RootPath:       repoDir,
		DefaultBackend: "codex",
	}); err == nil {
		t.Fatalf("expected duplicate project root to be rejected")
	}
}

func TestUpdateSessionAppendsTranscriptItems(t *testing.T) {
	root := t.TempDir()
	repoDir := filepath.Join(root, "orchd")
	if err := os.MkdirAll(filepath.Join(repoDir, ".git"), 0o755); err != nil {
		t.Fatalf("mkdir repo .git: %v", err)
	}

	workspace := NewInMemoryWorkspace("test-host", nil)
	project, err := workspace.CreateProject(CreateProjectInput{
		Name:           "orchd",
		RootPath:       repoDir,
		DefaultBackend: "codex",
	})
	if err != nil {
		t.Fatalf("CreateProject: %v", err)
	}

	session, err := workspace.CreateSession(CreateSessionInput{
		ProjectID: project.ID,
		Title:     "probe",
		Prompt:    "first",
	})
	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}

	firstBatch := []SessionTranscriptItem{
		{ID: "u1", Kind: SessionTranscriptItemKindUserMessage, Title: "You", Body: "hello"},
	}
	if _, err := workspace.UpdateSession(session.ID, SessionPatch{
		AppendTranscriptItems: &firstBatch,
	}); err != nil {
		t.Fatalf("UpdateSession first append: %v", err)
	}

	secondBatch := []SessionTranscriptItem{
		{ID: "a1", Kind: SessionTranscriptItemKindAgentMessage, Title: "Codex", Body: "hi"},
	}
	updated, err := workspace.UpdateSession(session.ID, SessionPatch{
		AppendTranscriptItems: &secondBatch,
	})
	if err != nil {
		t.Fatalf("UpdateSession second append: %v", err)
	}

	if len(updated.TranscriptItems) != 2 {
		t.Fatalf("transcript len = %d, want 2", len(updated.TranscriptItems))
	}
	if updated.TranscriptItems[0].ID != "u1" || updated.TranscriptItems[1].ID != "a1" {
		t.Fatalf("unexpected transcript items: %#v", updated.TranscriptItems)
	}
}
