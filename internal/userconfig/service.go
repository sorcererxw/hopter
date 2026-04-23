package userconfig

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/sorcererxw/hopter/internal/core"
)

const (
	ThemeSystem Theme = "system"
	ThemeDark   Theme = "dark"
	ThemeLight  Theme = "light"

	LocaleSystem Locale = "system"
	LocaleEN     Locale = "en"
	LocaleZhCN   Locale = "zh-CN"

	ComposerSendShortcutCmdEnter ComposerSendShortcut = "cmd-enter"
	ComposerSendShortcutEnter    ComposerSendShortcut = "enter"

	schemaFileName  = "config.schema.json"
	schemaReference = "./" + schemaFileName
)

var ErrRevisionConflict = errors.New("config revision conflict")

type Theme string

type Locale string

type ComposerSendShortcut string

type AppearanceConfig struct {
	Theme  Theme  `json:"theme"`
	Locale Locale `json:"locale"`
}

type AgentConfig struct {
	DefaultBackend         string `json:"defaultBackend"`
	DefaultModel           string `json:"defaultModel,omitempty"`
	DefaultReasoningEffort string `json:"defaultReasoningEffort,omitempty"`
	DefaultCodexFastMode   bool   `json:"defaultCodexFastMode,omitempty"`
}

type ComposerConfig struct {
	SendShortcut ComposerSendShortcut `json:"sendShortcut"`
}

type Config struct {
	Schema     string           `json:"$schema,omitempty"`
	Appearance AppearanceConfig `json:"appearance"`
	Agent      AgentConfig      `json:"agent"`
	Composer   ComposerConfig   `json:"composer"`
	Revision   uint64           `json:"-"`
	UpdatedAt  time.Time        `json:"-"`
}

type Patch struct {
	Appearance       *AppearanceConfig
	Agent            *AgentConfig
	Composer         *ComposerConfig
	ExpectedRevision uint64
}

type Service struct {
	mu        sync.RWMutex
	path      string
	eventSink core.EventSink
	config    Config
}

func DefaultPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("resolve home directory: %w", err)
	}
	return filepath.Join(home, ".hopter", "config.json"), nil
}

func NewService(path string, eventSink core.EventSink) (*Service, error) {
	if strings.TrimSpace(path) == "" {
		defaultPath, err := DefaultPath()
		if err != nil {
			return nil, err
		}
		path = defaultPath
	}

	cfg, err := load(path)
	if err != nil {
		return nil, err
	}
	if err := ensureConfigDir(path); err != nil {
		return nil, err
	}
	if err := writeSchemaAtomic(filepath.Join(filepath.Dir(path), schemaFileName)); err != nil {
		return nil, err
	}

	return &Service{
		path:      path,
		eventSink: eventSink,
		config:    cfg,
	}, nil
}

func (s *Service) Path() string {
	return s.path
}

func (s *Service) Get() Config {
	s.mu.RLock()
	defer s.mu.RUnlock()

	return s.config
}

func (s *Service) Update(patch Patch) (Config, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if patch.ExpectedRevision > 0 && patch.ExpectedRevision != s.config.Revision {
		return Config{}, ErrRevisionConflict
	}
	if patch.Appearance == nil && patch.Agent == nil && patch.Composer == nil {
		return s.config, nil
	}

	next := s.config
	if patch.Appearance != nil {
		next.Appearance = *patch.Appearance
	}
	if patch.Agent != nil {
		next.Agent = *patch.Agent
	}
	if patch.Composer != nil {
		next.Composer = *patch.Composer
	}
	next = normalize(next)
	if err := validate(next); err != nil {
		return Config{}, err
	}
	next.Revision = s.config.Revision + 1
	next.UpdatedAt = time.Now().UTC()

	if err := writeAtomic(s.path, next); err != nil {
		return Config{}, err
	}

	s.config = next
	if s.eventSink != nil {
		s.eventSink.Publish(core.Event{Kind: core.EventConfigChanged})
	}
	return next, nil
}

func load(path string) (Config, error) {
	cfg := defaultConfig()
	data, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return cfg, nil
		}
		return Config{}, fmt.Errorf("read config %q: %w", path, err)
	}
	if len(strings.TrimSpace(string(data))) == 0 {
		return cfg, nil
	}
	if err := json.Unmarshal(data, &cfg); err != nil {
		return Config{}, fmt.Errorf("parse config %q: %w", path, err)
	}
	cfg = normalize(cfg)
	if err := validate(cfg); err != nil {
		return Config{}, fmt.Errorf("validate config %q: %w", path, err)
	}
	cfg.Revision = 1
	info, err := os.Stat(path)
	if err == nil {
		cfg.UpdatedAt = info.ModTime().UTC()
	}
	if cfg.UpdatedAt.IsZero() {
		cfg.UpdatedAt = time.Now().UTC()
	}
	return cfg, nil
}

func defaultConfig() Config {
	return Config{
		Schema:     schemaReference,
		Appearance: AppearanceConfig{Theme: ThemeSystem, Locale: LocaleSystem},
		Agent:      AgentConfig{DefaultBackend: core.BackendKeyCodex},
		Composer:   ComposerConfig{SendShortcut: ComposerSendShortcutCmdEnter},
		Revision:   1,
		UpdatedAt:  time.Now().UTC(),
	}
}

func normalize(cfg Config) Config {
	cfg.Schema = schemaReference
	cfg.Appearance.Theme = Theme(strings.TrimSpace(string(cfg.Appearance.Theme)))
	if cfg.Appearance.Theme == "" {
		cfg.Appearance.Theme = ThemeSystem
	}
	cfg.Appearance.Locale = Locale(strings.TrimSpace(string(cfg.Appearance.Locale)))
	if cfg.Appearance.Locale == "" {
		cfg.Appearance.Locale = LocaleSystem
	}
	cfg.Agent.DefaultBackend = strings.ToLower(strings.TrimSpace(cfg.Agent.DefaultBackend))
	if cfg.Agent.DefaultBackend == "" {
		cfg.Agent.DefaultBackend = core.BackendKeyCodex
	}
	cfg.Agent.DefaultModel = strings.TrimSpace(cfg.Agent.DefaultModel)
	cfg.Agent.DefaultReasoningEffort = strings.TrimSpace(cfg.Agent.DefaultReasoningEffort)
	cfg.Composer.SendShortcut = ComposerSendShortcut(strings.TrimSpace(string(cfg.Composer.SendShortcut)))
	if cfg.Composer.SendShortcut == "" {
		cfg.Composer.SendShortcut = ComposerSendShortcutCmdEnter
	}
	return cfg
}

func validate(cfg Config) error {
	switch cfg.Appearance.Theme {
	case ThemeSystem, ThemeDark, ThemeLight:
	default:
		return fmt.Errorf("appearance.theme must be one of system, dark, light")
	}
	switch cfg.Appearance.Locale {
	case LocaleSystem, LocaleEN, LocaleZhCN:
	default:
		return fmt.Errorf("appearance.locale must be one of system, en, zh-CN")
	}
	if cfg.Agent.DefaultBackend != core.BackendKeyCodex {
		return fmt.Errorf("agent.defaultBackend must be codex")
	}
	switch cfg.Composer.SendShortcut {
	case ComposerSendShortcutCmdEnter, ComposerSendShortcutEnter:
	default:
		return fmt.Errorf("composer.sendShortcut must be one of cmd-enter, enter")
	}
	return nil
}

func ensureConfigDir(path string) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return fmt.Errorf("create config directory: %w", err)
	}
	return nil
}

func writeAtomic(path string, cfg Config) error {
	if err := ensureConfigDir(path); err != nil {
		return err
	}
	if err := writeSchemaAtomic(filepath.Join(filepath.Dir(path), schemaFileName)); err != nil {
		return err
	}

	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return fmt.Errorf("encode config: %w", err)
	}
	data = append(data, '\n')

	tmp, err := os.CreateTemp(filepath.Dir(path), ".config-*.tmp")
	if err != nil {
		return fmt.Errorf("create temp config: %w", err)
	}
	tmpPath := tmp.Name()
	defer os.Remove(tmpPath)

	if _, err := tmp.Write(data); err != nil {
		_ = tmp.Close()
		return fmt.Errorf("write temp config: %w", err)
	}
	if err := tmp.Chmod(0o600); err != nil {
		_ = tmp.Close()
		return fmt.Errorf("chmod temp config: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("close temp config: %w", err)
	}
	if err := os.Rename(tmpPath, path); err != nil {
		return fmt.Errorf("replace config: %w", err)
	}
	return nil
}

func writeSchemaAtomic(path string) error {
	tmp, err := os.CreateTemp(filepath.Dir(path), ".config-schema-*.tmp")
	if err != nil {
		return fmt.Errorf("create temp config schema: %w", err)
	}
	tmpPath := tmp.Name()
	defer os.Remove(tmpPath)

	if _, err := tmp.WriteString(configSchemaJSON); err != nil {
		_ = tmp.Close()
		return fmt.Errorf("write temp config schema: %w", err)
	}
	if err := tmp.Chmod(0o644); err != nil {
		_ = tmp.Close()
		return fmt.Errorf("chmod temp config schema: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("close temp config schema: %w", err)
	}
	if err := os.Rename(tmpPath, path); err != nil {
		return fmt.Errorf("replace config schema: %w", err)
	}
	return nil
}

const configSchemaJSON = `{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://hopter.dev/schemas/config.schema.json",
  "title": "hopter config",
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "$schema": {
      "type": "string",
      "description": "JSON schema reference for editor validation."
    },
    "appearance": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "theme": {
          "type": "string",
          "enum": ["system", "dark", "light"],
          "default": "system"
        },
        "locale": {
          "type": "string",
          "enum": ["system", "en", "zh-CN"],
          "default": "system"
        }
      },
      "required": ["theme", "locale"]
    },
    "agent": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "defaultBackend": {
          "type": "string",
          "enum": ["codex"],
          "default": "codex",
          "minLength": 1
        },
        "defaultModel": {
          "type": "string"
        },
        "defaultReasoningEffort": {
          "type": "string"
        },
        "defaultCodexFastMode": {
          "type": "boolean"
        }
      },
      "required": ["defaultBackend"]
    },
    "composer": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "sendShortcut": {
          "type": "string",
          "enum": ["cmd-enter", "enter"],
          "default": "cmd-enter"
        }
      },
      "required": ["sendShortcut"]
    }
  },
  "required": ["appearance", "agent", "composer"]
}
`
