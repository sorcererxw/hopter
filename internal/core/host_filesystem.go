package core

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"slices"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"
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

type skillSearchRoot struct {
	Path     string
	Source   string
	Priority int
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
		if pathWithinRoot(cleanPath, rootPath) {
			return true
		}
	}
	return false
}

func pathWithinRoot(path string, rootPath string) bool {
	cleanPath := filepath.Clean(path)
	cleanRoot := filepath.Clean(rootPath)
	if cleanPath == cleanRoot {
		return true
	}
	return strings.HasPrefix(cleanPath, cleanRoot+string(filepath.Separator))
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

func ResolvePathWithinRoot(rootPath string, targetPath string) (string, error) {
	rootCanonical, info, err := resolvePath(rootPath)
	if err != nil {
		return "", err
	}
	if !info.IsDir() {
		return "", fmt.Errorf("project root %q must be a directory", rootCanonical)
	}

	targetTrimmed := strings.TrimSpace(targetPath)
	if targetTrimmed == "" {
		return "", errors.New("path is required")
	}

	resolvedCandidate := targetTrimmed
	if !filepath.IsAbs(targetTrimmed) {
		resolvedCandidate = filepath.Join(rootCanonical, targetTrimmed)
	}

	canonicalPath, fileInfo, err := resolvePath(resolvedCandidate)
	if err != nil {
		return "", err
	}
	if fileInfo.IsDir() {
		return "", fmt.Errorf("path %q is a directory", canonicalPath)
	}
	if !pathWithinRoot(canonicalPath, rootCanonical) {
		return "", fmt.Errorf("path %q is outside project root %q", canonicalPath, rootCanonical)
	}

	return canonicalPath, nil
}

func ResolveSessionFilePath(projectRoot string, targetPath string) (string, error) {
	targetTrimmed := strings.TrimSpace(targetPath)
	if targetTrimmed == "" {
		return "", errors.New("path is required")
	}

	if filepath.IsAbs(targetTrimmed) {
		canonicalPath, info, err := resolvePath(targetTrimmed)
		if err != nil {
			return "", err
		}
		if info.IsDir() {
			return "", fmt.Errorf("path %q is a directory", canonicalPath)
		}

		roots, err := discoverDirectoryRoots()
		if err != nil {
			return "", err
		}
		if !isAllowedPath(canonicalPath, roots) {
			return "", fmt.Errorf("path %q is outside allowed roots", canonicalPath)
		}
		return canonicalPath, nil
	}

	rootCanonical, info, err := resolvePath(projectRoot)
	if err != nil {
		return "", err
	}
	if !info.IsDir() {
		return "", fmt.Errorf("project root %q must be a directory", rootCanonical)
	}

	return ResolvePathWithinRoot(rootCanonical, targetTrimmed)
}

func ReadFilePreview(path string, maxBytes int64) (content string, truncated bool, isBinary bool, err error) {
	if maxBytes <= 0 {
		maxBytes = 128 * 1024
	}

	canonicalPath, info, err := resolvePath(path)
	if err != nil {
		return "", false, false, err
	}
	if info.IsDir() {
		return "", false, false, fmt.Errorf("path %q is a directory", canonicalPath)
	}

	file, err := os.Open(canonicalPath)
	if err != nil {
		return "", false, false, fmt.Errorf("open file %q: %w", canonicalPath, err)
	}
	defer file.Close()

	data, err := io.ReadAll(io.LimitReader(file, maxBytes+1))
	if err != nil {
		return "", false, false, fmt.Errorf("read file %q: %w", canonicalPath, err)
	}

	if int64(len(data)) > maxBytes {
		truncated = true
		data = data[:maxBytes]
	}

	if bytes.IndexByte(data, 0) >= 0 || !utf8.Valid(data) {
		return "", truncated, true, nil
	}

	return string(data), truncated, false, nil
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

func discoverSkills() ([]Skill, error) {
	return discoverSkillsFromRoots(discoverSkillRoots())
}

func discoverSkillRoots() []skillSearchRoot {
	roots := make([]skillSearchRoot, 0, 6)
	homeDir, err := os.UserHomeDir()
	if err == nil {
		roots = append(roots,
			skillSearchRoot{Path: filepath.Join(homeDir, ".codex", "skills"), Source: "local", Priority: 10},
			skillSearchRoot{Path: filepath.Join(homeDir, ".agents", "skills"), Source: "local", Priority: 20},
			skillSearchRoot{Path: filepath.Join(homeDir, ".claude", "skills"), Source: "local", Priority: 30},
			skillSearchRoot{Path: filepath.Join(homeDir, ".codex", "plugins", "cache"), Source: "plugin", Priority: 40},
		)
	}

	if cwd, err := os.Getwd(); err == nil {
		roots = append(roots,
			skillSearchRoot{Path: filepath.Join(cwd, ".codex", "skills"), Source: "project", Priority: 0},
			skillSearchRoot{Path: filepath.Join(cwd, ".agents", "skills"), Source: "project", Priority: 1},
		)
	}

	return roots
}

func discoverSkillsFromRoots(roots []skillSearchRoot) ([]Skill, error) {
	sortedRoots := slices.Clone(roots)
	sort.SliceStable(sortedRoots, func(i, j int) bool {
		if sortedRoots[i].Priority != sortedRoots[j].Priority {
			return sortedRoots[i].Priority < sortedRoots[j].Priority
		}
		return sortedRoots[i].Path < sortedRoots[j].Path
	})

	skillsByReference := make(map[string]Skill)
	for _, root := range sortedRoots {
		if !dirExists(root.Path) {
			continue
		}

		err := filepath.WalkDir(root.Path, func(path string, d fs.DirEntry, walkErr error) error {
			if walkErr != nil {
				return nil
			}
			if d.IsDir() {
				name := d.Name()
				if name == "node_modules" || name == ".git" {
					return filepath.SkipDir
				}
				if path != root.Path && strings.HasPrefix(name, ".") {
					return filepath.SkipDir
				}
				return nil
			}
			if d.Name() != "SKILL.md" {
				return nil
			}

			skill, err := readSkillSummary(path, root.Source)
			if err != nil || skill.Reference == "" {
				return nil
			}
			if _, exists := skillsByReference[skill.Reference]; exists {
				return nil
			}
			skillsByReference[skill.Reference] = skill
			return nil
		})
		if err != nil {
			return nil, fmt.Errorf("discover skills in %q: %w", root.Path, err)
		}
	}

	skills := make([]Skill, 0, len(skillsByReference))
	for _, skill := range skillsByReference {
		skills = append(skills, skill)
	}
	sort.SliceStable(skills, func(i, j int) bool {
		if skills[i].Source != skills[j].Source {
			return skills[i].Source < skills[j].Source
		}
		if skills[i].Name != skills[j].Name {
			return strings.ToLower(skills[i].Name) < strings.ToLower(skills[j].Name)
		}
		return skills[i].Reference < skills[j].Reference
	})
	return skills, nil
}

func readSkillSummary(path string, source string) (Skill, error) {
	content, err := os.ReadFile(path)
	if err != nil {
		return Skill{}, err
	}

	name, description := parseSkillFrontmatter(string(content))
	if name == "" {
		name = filepath.Base(filepath.Dir(path))
	}

	reference := normalizeSkillReference(name)
	if reference == "" {
		return Skill{}, fmt.Errorf("skill %q produced empty reference", path)
	}

	return Skill{
		Name:        strings.TrimSpace(name),
		Reference:   reference,
		Description: strings.TrimSpace(description),
		Source:      source,
		Path:        path,
	}, nil
}

func parseSkillFrontmatter(content string) (string, string) {
	if !strings.HasPrefix(content, "---") {
		return "", ""
	}

	parts := strings.SplitN(content, "\n---", 2)
	if len(parts) != 2 {
		return "", ""
	}

	var name string
	var description string
	for _, rawLine := range strings.Split(parts[0], "\n")[1:] {
		line := strings.TrimSpace(rawLine)
		switch {
		case strings.HasPrefix(line, "name:"):
			name = parseYAMLScalar(strings.TrimSpace(strings.TrimPrefix(line, "name:")))
		case strings.HasPrefix(line, "description:"):
			description = parseYAMLScalar(strings.TrimSpace(strings.TrimPrefix(line, "description:")))
		}
	}

	return name, description
}

func parseYAMLScalar(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return ""
	}

	if unquoted, err := strconv.Unquote(trimmed); err == nil {
		return unquoted
	}

	return strings.Trim(trimmed, `"'`)
}

func normalizeSkillReference(name string) string {
	trimmed := strings.TrimSpace(strings.ToLower(name))
	if trimmed == "" {
		return ""
	}

	var b strings.Builder
	lastDash := false
	for _, r := range trimmed {
		switch {
		case (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9'):
			b.WriteRune(r)
			lastDash = false
		case r == ':' || r == '/':
			if b.Len() > 0 && !lastDash {
				b.WriteRune(r)
				lastDash = true
			}
		default:
			if b.Len() == 0 || lastDash {
				continue
			}
			b.WriteRune('-')
			lastDash = true
		}
	}

	return strings.Trim(b.String(), "-:/")
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
