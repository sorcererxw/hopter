package sdk

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

type outputSchemaFile struct {
	schemaPath string
	cleanup    func() error
}

func createOutputSchemaFile(schema map[string]any) (*outputSchemaFile, error) {
	if schema == nil {
		return &outputSchemaFile{cleanup: func() error { return nil }}, nil
	}
	dir, err := os.MkdirTemp("", "codex-output-schema-")
	if err != nil {
		return nil, err
	}
	path := filepath.Join(dir, "schema.json")
	cleanup := func() error {
		return os.RemoveAll(dir)
	}
	payload, err := json.Marshal(schema)
	if err != nil {
		_ = cleanup()
		return nil, fmt.Errorf("%w: %v", ErrInvalidSchema, err)
	}
	if err := os.WriteFile(path, payload, 0o600); err != nil {
		_ = cleanup()
		return nil, err
	}
	return &outputSchemaFile{
		schemaPath: path,
		cleanup:    cleanup,
	}, nil
}
