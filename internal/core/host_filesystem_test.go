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
