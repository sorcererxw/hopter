package core

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"sort"
	"strings"
)

var preferredBrowseDirs = []struct {
	Label string
	Name  string
	Kind  string
}{
	{Label: "Desktop", Name: "Desktop", Kind: "favorite"},
	{Label: "Documents", Name: "Documents", Kind: "favorite"},
	{Label: "Downloads", Name: "Downloads", Kind: "favorite"},
	{Label: "Workspace", Name: "workspace", Kind: "favorite"},
	{Label: "Repos", Name: "repos", Kind: "favorite"},
	{Label: "Repo", Name: "repo", Kind: "favorite"},
	{Label: "Code", Name: "code", Kind: "favorite"},
	{Label: "Src", Name: "src", Kind: "favorite"},
}

func discoverDirectoryRoots() ([]DirectoryRoot, error) {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return nil, fmt.Errorf("resolve home directory: %w", err)
	}
	homeDir, err = canonicalizeExistingPath(homeDir)
	if err != nil {
		return nil, fmt.Errorf("canonicalize home directory: %w", err)
	}

	roots := []DirectoryRoot{{
		Label: "Home",
		Path:  filepath.Clean(homeDir),
		Kind:  "home",
	}}

	for _, candidate := range preferredBrowseDirs {
		path := filepath.Join(homeDir, candidate.Name)
		if dirExists(path) {
			path, err = canonicalizeExistingPath(path)
			if err != nil {
				continue
			}
			roots = append(roots, DirectoryRoot{
				Label: candidate.Label,
				Path:  path,
				Kind:  candidate.Kind,
			})
		}
	}

	for _, candidate := range []DirectoryRoot{
		{Label: "Volumes", Path: "/Volumes", Kind: "system"},
		{Label: "Temporary", Path: os.TempDir(), Kind: "system"},
	} {
		if dirExists(candidate.Path) {
			canonicalPath, err := canonicalizeExistingPath(candidate.Path)
			if err != nil {
				continue
			}
			roots = append(roots, DirectoryRoot{
				Label: candidate.Label,
				Path:  canonicalPath,
				Kind:  candidate.Kind,
			})
		}
	}

	sort.SliceStable(roots, func(i, j int) bool {
		if roots[i].Kind == roots[j].Kind {
			return strings.ToLower(roots[i].Label) < strings.ToLower(roots[j].Label)
		}
		if roots[i].Kind == "home" {
			return true
		}
		if roots[j].Kind == "home" {
			return false
		}
		if roots[i].Kind == "favorite" && roots[j].Kind == "system" {
			return true
		}
		return false
	})

	return dedupeRoots(roots), nil
}

func dedupeRoots(roots []DirectoryRoot) []DirectoryRoot {
	seen := make(map[string]struct{}, len(roots))
	result := make([]DirectoryRoot, 0, len(roots))
	for _, root := range roots {
		if _, ok := seen[root.Path]; ok {
			continue
		}
		seen[root.Path] = struct{}{}
		result = append(result, root)
	}
	return result
}

func canonicalizeExistingPath(path string) (string, error) {
	absolutePath, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	canonicalPath, err := filepath.EvalSymlinks(absolutePath)
	if err != nil {
		return "", err
	}
	return filepath.Clean(canonicalPath), nil
}

func listDirectory(path string) (DirectoryListing, error) {
	canonicalPath, _, err := resolveDirectory(path)
	if err != nil {
		return DirectoryListing{}, err
	}

	roots, err := discoverDirectoryRoots()
	if err != nil {
		return DirectoryListing{}, err
	}
	if !isAllowedPath(canonicalPath, roots) {
		return DirectoryListing{}, fmt.Errorf("path %q is outside allowed roots", canonicalPath)
	}

	dirEntries, err := os.ReadDir(canonicalPath)
	if err != nil {
		return DirectoryListing{}, fmt.Errorf("read directory %q: %w", canonicalPath, err)
	}

	entries := make([]DirectoryEntry, 0, len(dirEntries))
	for _, entry := range dirEntries {
		name := entry.Name()
		if shouldHideEntry(name) {
			continue
		}

		entryPath := filepath.Join(canonicalPath, name)
		resolvedPath, entryInfo, err := resolvePath(entryPath)
		if err != nil {
			continue
		}

		isDirectory := entryInfo.IsDir()
		entries = append(entries, DirectoryEntry{
			Name:        name,
			Path:        resolvedPath,
			IsDirectory: isDirectory,
			IsRepo:      isGitRepository(resolvedPath),
			HasChildren: isDirectory && directoryHasVisibleChildren(resolvedPath),
			IsAllowed:   isAllowedPath(resolvedPath, roots),
		})
	}

	sort.SliceStable(entries, func(i, j int) bool {
		if entries[i].IsDirectory != entries[j].IsDirectory {
			return entries[i].IsDirectory
		}
		return strings.ToLower(entries[i].Name) < strings.ToLower(entries[j].Name)
	})

	parentPath := filepath.Dir(canonicalPath)
	if parentPath == "." || parentPath == canonicalPath {
		parentPath = ""
	}

	return DirectoryListing{
		CurrentPath: canonicalPath,
		ParentPath:  parentPath,
		Entries:     entries,
	}, nil
}

func getPathMetadata(path string) (PathMetadata, error) {
	canonicalPath, info, err := resolvePath(path)
	if err != nil {
		return PathMetadata{}, err
	}

	roots, err := discoverDirectoryRoots()
	if err != nil {
		return PathMetadata{}, err
	}

	metadata := PathMetadata{
		Path:          strings.TrimSpace(path),
		CanonicalPath: canonicalPath,
		Basename:      info.Name(),
		IsDirectory:   info.IsDir(),
		IsRepo:        isGitRepository(canonicalPath),
		IsAllowed:     isAllowedPath(canonicalPath, roots),
		ModifiedAt:    info.ModTime().UTC(),
	}

	if metadata.Basename == "." || metadata.Basename == string(filepath.Separator) || metadata.Basename == "" {
		metadata.Basename = canonicalPath
	}

	if metadata.IsDirectory {
		dirEntries, err := os.ReadDir(canonicalPath)
		if err == nil {
			for _, entry := range dirEntries {
				if shouldHideEntry(entry.Name()) {
					continue
				}
				entryPath := filepath.Join(canonicalPath, entry.Name())
				_, entryInfo, err := resolvePath(entryPath)
				if err != nil {
					continue
				}
				if entryInfo.IsDir() {
					metadata.ChildDirectoryCount++
				} else {
					metadata.ChildFileCount++
				}
			}
		}
	}

	return metadata, nil
}

func resolveDirectory(path string) (string, os.FileInfo, error) {
	canonicalPath, info, err := resolvePath(path)
	if err != nil {
		return "", nil, err
	}
	if !info.IsDir() {
		return "", nil, fmt.Errorf("path %q is not a directory", canonicalPath)
	}
	return canonicalPath, info, nil
}

func resolvePath(path string) (string, os.FileInfo, error) {
	trimmedPath := strings.TrimSpace(path)
	if trimmedPath == "" {
		return "", nil, errors.New("path is required")
	}

	absolutePath, err := filepath.Abs(trimmedPath)
	if err != nil {
		return "", nil, fmt.Errorf("resolve absolute path %q: %w", trimmedPath, err)
	}

	canonicalPath, err := filepath.EvalSymlinks(absolutePath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return "", nil, fmt.Errorf("path %q does not exist", trimmedPath)
		}
		canonicalPath = absolutePath
	}

	info, err := os.Stat(canonicalPath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return "", nil, fmt.Errorf("path %q does not exist", trimmedPath)
		}
		return "", nil, fmt.Errorf("stat path %q: %w", canonicalPath, err)
	}

	return filepath.Clean(canonicalPath), info, nil
}

func isAllowedPath(path string, roots []DirectoryRoot) bool {
	cleanPath := filepath.Clean(path)
	for _, root := range roots {
		rootPath := filepath.Clean(root.Path)
		if cleanPath == rootPath {
			return true
		}
		if strings.HasPrefix(cleanPath, rootPath+string(filepath.Separator)) {
			return true
		}
	}
	return false
}

func shouldHideEntry(name string) bool {
	return strings.HasPrefix(name, ".")
}

func directoryHasVisibleChildren(path string) bool {
	entries, err := os.ReadDir(path)
	if err != nil {
		return false
	}
	for _, entry := range entries {
		if shouldHideEntry(entry.Name()) {
			continue
		}
		return true
	}
	return false
}

func isGitRepository(path string) bool {
	gitPath := filepath.Join(path, ".git")
	info, err := os.Stat(gitPath)
	if err != nil {
		return false
	}
	return info.IsDir() || info.Mode().IsRegular()
}

func dirExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.IsDir()
}

func validateProjectRoot(path string) (string, error) {
	canonicalPath, info, err := resolvePath(path)
	if err != nil {
		return "", err
	}
	if !info.IsDir() {
		return "", fmt.Errorf("project root %q must be a directory", canonicalPath)
	}

	roots, err := discoverDirectoryRoots()
	if err != nil {
		return "", err
	}
	if !isAllowedPath(canonicalPath, roots) {
		return "", fmt.Errorf("project root %q is outside allowed roots", canonicalPath)
	}
	if !isGitRepository(canonicalPath) {
		return "", fmt.Errorf("project root %q is not a git repository", canonicalPath)
	}

	return canonicalPath, nil
}

func listRecentRepos(projects []Project, limit uint32) ([]PathMetadata, error) {
	if limit == 0 {
		limit = 6
	}

	result := make([]PathMetadata, 0, min(int(limit), len(projects)))
	seen := make(map[string]struct{}, len(projects))
	sortedProjects := slices.Clone(projects)
	sort.SliceStable(sortedProjects, func(i, j int) bool {
		return sortedProjects[i].UpdatedAt.After(sortedProjects[j].UpdatedAt)
	})

	for _, project := range sortedProjects {
		metadata, err := getPathMetadata(project.RootPath)
		if err != nil || !metadata.IsRepo || !metadata.IsAllowed {
			continue
		}
		if _, ok := seen[metadata.CanonicalPath]; ok {
			continue
		}
		seen[metadata.CanonicalPath] = struct{}{}
		result = append(result, metadata)
		if len(result) >= int(limit) {
			break
		}
	}

	return result, nil
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
