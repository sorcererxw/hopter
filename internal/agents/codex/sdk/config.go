package sdk

import (
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"strings"
)

func serializeConfigOverrides(config map[string]any) ([]string, error) {
	if len(config) == 0 {
		return nil, nil
	}
	keys := make([]string, 0, len(config))
	for key := range config {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	var overrides []string
	for _, key := range keys {
		if err := flattenConfigOverrides(config[key], key, &overrides); err != nil {
			return nil, err
		}
	}
	return overrides, nil
}

func flattenConfigOverrides(value any, prefix string, overrides *[]string) error {
	if prefix == "" {
		return fmt.Errorf("config override keys must be non-empty")
	}
	object, isObject := value.(map[string]any)
	if isObject {
		if len(object) == 0 {
			*overrides = append(*overrides, prefix+"={}")
			return nil
		}
		keys := make([]string, 0, len(object))
		for key := range object {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		for _, key := range keys {
			if key == "" {
				return fmt.Errorf("config override keys must be non-empty")
			}
			if object[key] == nil {
				continue
			}
			if err := flattenConfigOverrides(object[key], prefix+"."+key, overrides); err != nil {
				return err
			}
		}
		return nil
	}
	rendered, err := toTOMLValue(value, prefix)
	if err != nil {
		return err
	}
	*overrides = append(*overrides, prefix+"="+rendered)
	return nil
}

func toTOMLValue(value any, path string) (string, error) {
	switch v := value.(type) {
	case string:
		raw, err := json.Marshal(v)
		if err != nil {
			return "", err
		}
		return string(raw), nil
	case bool:
		if v {
			return "true", nil
		}
		return "false", nil
	case int:
		return itoa(v), nil
	case int8:
		return itoa(int(v)), nil
	case int16:
		return itoa(int(v)), nil
	case int32:
		return itoa(int(v)), nil
	case int64:
		return fmt.Sprintf("%d", v), nil
	case uint:
		return fmt.Sprintf("%d", v), nil
	case uint8:
		return fmt.Sprintf("%d", v), nil
	case uint16:
		return fmt.Sprintf("%d", v), nil
	case uint32:
		return fmt.Sprintf("%d", v), nil
	case uint64:
		return fmt.Sprintf("%d", v), nil
	case float32:
		if !isFinite(float64(v)) {
			return "", fmt.Errorf("config override at %s must be a finite number", path)
		}
		return strconvFloat(float64(v)), nil
	case float64:
		if !isFinite(v) {
			return "", fmt.Errorf("config override at %s must be a finite number", path)
		}
		return strconvFloat(v), nil
	case []any:
		rendered := make([]string, 0, len(v))
		for index, item := range v {
			part, err := toTOMLValue(item, fmt.Sprintf("%s[%d]", path, index))
			if err != nil {
				return "", err
			}
			rendered = append(rendered, part)
		}
		return "[" + strings.Join(rendered, ", ") + "]", nil
	case map[string]any:
		keys := make([]string, 0, len(v))
		for key := range v {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		parts := make([]string, 0, len(keys))
		for _, key := range keys {
			if key == "" {
				return "", fmt.Errorf("config override keys must be non-empty")
			}
			if v[key] == nil {
				continue
			}
			part, err := toTOMLValue(v[key], path+"."+key)
			if err != nil {
				return "", err
			}
			parts = append(parts, formatTOMLKey(key)+" = "+part)
		}
		return "{" + strings.Join(parts, ", ") + "}", nil
	case nil:
		return "", fmt.Errorf("config override at %s cannot be null", path)
	default:
		return "", fmt.Errorf("unsupported config override at %s: %T", path, value)
	}
}

func isFinite(v float64) bool {
	return !math.IsInf(v, 0) && !math.IsNaN(v)
}

func strconvFloat(v float64) string {
	return strings.TrimRight(strings.TrimRight(fmt.Sprintf("%.12f", v), "0"), ".")
}

func formatTOMLKey(key string) string {
	valid := true
	for _, r := range key {
		if (r >= 'A' && r <= 'Z') || (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '_' || r == '-' {
			continue
		}
		valid = false
		break
	}
	if valid {
		return key
	}
	raw, _ := json.Marshal(key)
	return string(raw)
}
