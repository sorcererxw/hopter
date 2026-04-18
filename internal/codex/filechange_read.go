package codex

import (
	"encoding/json"
	"strings"
)

type fileChangePayload struct {
	Version int                      `json:"version"`
	Changes []fileChangePayloadEntry `json:"changes"`
}

type fileChangePayloadEntry struct {
	Path      string  `json:"path"`
	Kind      string  `json:"kind"`
	MovePath  *string `json:"movePath,omitempty"`
	Additions int     `json:"additions,omitempty"`
	Deletions int     `json:"deletions,omitempty"`
	Diff      string  `json:"diff,omitempty"`
}

func formatReadThreadFileChanges(changes []ReadThreadFileChange) string {
	return formatReadThreadFileChangesPayload(changes, true)
}

func formatReadThreadFileChangesCompact(changes []ReadThreadFileChange) string {
	return formatReadThreadFileChangesPayload(changes, false)
}

func formatReadThreadFileChangesPayload(changes []ReadThreadFileChange, includeDiff bool) string {
	payload := fileChangePayload{
		Version: 1,
		Changes: make([]fileChangePayloadEntry, 0, len(changes)),
	}

	for _, change := range changes {
		path := strings.TrimSpace(change.Path)
		if path == "" {
			continue
		}
		additions, deletions := diffStats(change.Diff)
		payload.Changes = append(payload.Changes, fileChangePayloadEntry{
			Path:      path,
			Kind:      strings.TrimSpace(change.Kind.Type),
			MovePath:  change.Kind.MovePath,
			Additions: additions,
			Deletions: deletions,
		})
		if includeDiff {
			payload.Changes[len(payload.Changes)-1].Diff = strings.TrimSpace(change.Diff)
		}
	}

	if len(payload.Changes) == 0 {
		return ""
	}

	raw, err := json.Marshal(payload)
	if err != nil {
		return ""
	}
	return string(raw)
}

func diffStats(diff string) (int, int) {
	additions := 0
	deletions := 0
	for _, line := range strings.Split(strings.TrimSpace(diff), "\n") {
		switch {
		case strings.HasPrefix(line, "+++") || strings.HasPrefix(line, "---"):
			continue
		case strings.HasPrefix(line, "+"):
			additions++
		case strings.HasPrefix(line, "-"):
			deletions++
		}
	}
	return additions, deletions
}
