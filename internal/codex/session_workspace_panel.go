package codex

import (
	"path/filepath"
	"regexp"
	"strconv"
	"strings"

	"orchd/internal/core"
)

const maxSessionFilePreviewBytes = 128 * 1024

var (
	hashLineRefPattern  = regexp.MustCompile(`^(?P<path>.+?)#L(?P<line>\d+)(?:C(?P<column>\d+))?$`)
	colonLineRefPattern = regexp.MustCompile(`^(?P<path>.+?):(?P<line>\d+)(?::(?P<column>\d+))?$`)
)

func (m *SessionReadModel) GetSessionReview(sessionID string) (core.SessionReview, error) {
	meta, err := m.GetSessionMeta(sessionID)
	if err != nil {
		return core.SessionReview{}, err
	}

	review := core.SessionReview{
		SessionID: meta.Session.ID,
		ProjectID: meta.Project.ID,
	}

	if isLocalOnlySession(meta.Session) || !strings.EqualFold(strings.TrimSpace(meta.Session.BackendKey), "codex") {
		review.Reason = "Review is only available for completed Codex turns."
		return review, nil
	}

	read, err := m.readCodexTranscript(meta.Session.ID, meta.Project, meta.Session.BackendThreadID)
	if err != nil {
		return core.SessionReview{}, err
	}

	review.PendingTurnInProgress = latestActiveTurnID(read) != ""
	turn, ok := latestCompletedTurn(read)
	if !ok {
		if review.PendingTurnInProgress {
			review.Reason = "This turn is still running. Review will appear after it completes."
		} else {
			review.Reason = "No completed turn is available to review yet."
		}
		return review, nil
	}

	review.TurnID = turn.ID
	review.GeneratedAt = meta.Session.UpdatedAt

	files, fullPatch := reviewFilesFromTurn(turn)
	review.Files = files
	review.FullPatch = fullPatch
	review.Available = len(files) > 0 || strings.TrimSpace(fullPatch) != ""
	if !review.Available {
		review.Reason = "The latest completed turn did not produce a reviewable diff."
	}

	return review, nil
}

func (m *SessionReadModel) GetSessionFile(input core.GetSessionFileInput) (core.SessionFile, error) {
	meta, err := m.GetSessionMeta(input.SessionID)
	if err != nil {
		return core.SessionFile{}, err
	}

	requestedPath, parsedLine, parsedColumn := parseSessionFileReference(input.Path)
	line := int(input.Line)
	column := int(input.Column)
	if line == 0 {
		line = parsedLine
	}
	if column == 0 {
		column = parsedColumn
	}

	result := core.SessionFile{
		SessionID:     meta.Session.ID,
		ProjectID:     meta.Project.ID,
		RequestedPath: strings.TrimSpace(input.Path),
		InitialLine:   line,
		InitialColumn: column,
	}

	if strings.TrimSpace(requestedPath) == "" {
		result.Reason = "No file path was provided."
		return result, nil
	}

	canonicalPath, err := core.ResolveSessionFilePath(meta.Project.RootPath, requestedPath)
	if err != nil {
		result.Reason = err.Error()
		return result, nil
	}

	result.CanonicalPath = canonicalPath
	if strings.TrimSpace(meta.Project.RootPath) != "" {
		if relativePath, relErr := filepath.Rel(meta.Project.RootPath, canonicalPath); relErr == nil && !strings.HasPrefix(relativePath, "..") {
			result.DisplayPath = filepath.ToSlash(relativePath)
		}
	}
	if strings.TrimSpace(result.DisplayPath) == "" || result.DisplayPath == "." {
		result.DisplayPath = canonicalPath
	}

	content, truncated, isBinary, err := core.ReadFilePreview(canonicalPath, maxSessionFilePreviewBytes)
	if err != nil {
		result.Reason = err.Error()
		return result, nil
	}

	result.Available = true
	result.Truncated = truncated
	result.IsBinary = isBinary
	if isBinary {
		result.Reason = "Binary file not previewable."
		return result, nil
	}

	result.Content = content
	if content != "" {
		result.LineCount = strings.Count(content, "\n") + 1
	}
	if result.InitialLine > result.LineCount && result.LineCount > 0 {
		result.InitialLine = result.LineCount
	}

	return result, nil
}

func latestCompletedTurn(read *ReadThreadResult) (ReadThreadTurn, bool) {
	if read == nil {
		return ReadThreadTurn{}, false
	}
	for index := len(read.Thread.Turns) - 1; index >= 0; index-- {
		turn := read.Thread.Turns[index]
		if turn.Status == "completed" {
			return turn, true
		}
	}
	return ReadThreadTurn{}, false
}

func reviewFilesFromTurn(turn ReadThreadTurn) ([]core.SessionReviewFile, string) {
	type aggregatedFile struct {
		file core.SessionReviewFile
	}

	filesByPath := make(map[string]*aggregatedFile)
	orderedPaths := make([]string, 0)
	patches := make([]string, 0)

	for _, item := range turn.Items {
		if item.Type != "fileChange" {
			continue
		}
		for _, change := range item.Changes {
			path := strings.TrimSpace(change.Path)
			if path == "" {
				continue
			}

			existing, ok := filesByPath[path]
			if !ok {
				label := filepath.Base(path)
				if label == "." || label == string(filepath.Separator) || label == "" {
					label = path
				}
				existing = &aggregatedFile{
					file: core.SessionReviewFile{
						Path:         path,
						Kind:         describeReviewChangeKind(change.Kind.Type),
						DisplayLabel: label,
					},
				}
				filesByPath[path] = existing
				orderedPaths = append(orderedPaths, path)
			}

			additions, deletions := diffStats(change.Diff)
			existing.file.Additions += additions
			existing.file.Deletions += deletions
			if movePath := strings.TrimSpace(firstNonNilString(change.Kind.MovePath)); movePath != "" {
				existing.file.MovePath = movePath
			}
			if strings.TrimSpace(existing.file.Diff) == "" {
				existing.file.Diff = strings.TrimSpace(change.Diff)
			} else if trimmedDiff := strings.TrimSpace(change.Diff); trimmedDiff != "" {
				existing.file.Diff = existing.file.Diff + "\n" + trimmedDiff
			}
			if trimmedDiff := strings.TrimSpace(change.Diff); trimmedDiff != "" {
				patches = append(patches, trimmedDiff)
			}
		}
	}

	files := make([]core.SessionReviewFile, 0, len(orderedPaths))
	for _, path := range orderedPaths {
		files = append(files, filesByPath[path].file)
	}

	return files, strings.Join(patches, "\n\n")
}

func describeReviewChangeKind(kind string) string {
	switch strings.ToLower(strings.TrimSpace(kind)) {
	case "add", "added", "create", "created":
		return "Added"
	case "delete", "deleted":
		return "Deleted"
	case "move", "rename", "renamed":
		return "Moved"
	default:
		return "Edited"
	}
}

func parseSessionFileReference(raw string) (path string, line int, column int) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return "", 0, 0
	}

	if matches := hashLineRefPattern.FindStringSubmatch(trimmed); matches != nil {
		line, _ = strconv.Atoi(matches[2])
		if matches[3] != "" {
			column, _ = strconv.Atoi(matches[3])
		}
		return strings.TrimSpace(matches[1]), line, column
	}

	if matches := colonLineRefPattern.FindStringSubmatch(trimmed); matches != nil {
		line, _ = strconv.Atoi(matches[2])
		if matches[3] != "" {
			column, _ = strconv.Atoi(matches[3])
		}
		return strings.TrimSpace(matches[1]), line, column
	}

	return trimmed, 0, 0
}

func firstNonNilString(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}
