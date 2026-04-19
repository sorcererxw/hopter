package update

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/sorcererxw/hopter/internal/core"
)

var (
	ErrNoUpdateAvailable    = errors.New("no update available")
	ErrUpdateNotSelfManaged = errors.New("update is managed by external package manager")
	ErrUpdateBusy           = errors.New("update is already in progress")
)

type Service struct {
	mu             sync.RWMutex
	currentVersion string
	currentCommit  string
	channel        string
	installSource  core.InstallSource
	httpClient     *http.Client
	reexecDelay    time.Duration
	reexec         func(string) error
	status         core.UpdateStatus
}

func NewService(currentVersion string, installSource string) *Service {
	channel := envValue("HOPTER_UPDATE_CHANNEL")
	if channel == "" {
		channel = "stable"
	}
	currentCommit := envValue("HOPTER_COMMIT")
	if currentCommit == "" {
		currentCommit = "unknown"
	}

	source := resolveInstallSource(installSource)
	policy := policyForInstallSource(source)

	service := &Service{
		currentVersion: strings.TrimSpace(currentVersion),
		currentCommit:  currentCommit,
		channel:        channel,
		installSource:  source,
		httpClient: &http.Client{
			Timeout: 5 * time.Second,
		},
		reexecDelay: 150 * time.Millisecond,
		status: core.UpdateStatus{
			CurrentVersion:     strings.TrimSpace(currentVersion),
			CurrentCommit:      currentCommit,
			Channel:            channel,
			InstallSource:      source,
			UpdatePolicy:       policy,
			State:              core.UpdateStateIdle,
			UpgradeCommandHint: commandHintForInstallSource(source),
		},
	}
	service.reexec = service.performReexec
	return service
}

func (s *Service) GetStatus() core.UpdateStatus {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return cloneStatus(s.status)
}

func (s *Service) Check(force bool) (core.UpdateStatus, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	status := cloneStatus(s.status)
	status.State = core.UpdateStateChecking
	status.FailureReason = ""

	if !force && !status.LastCheckedAt.IsZero() && time.Since(status.LastCheckedAt) < 30*time.Second {
		return status, nil
	}

	availableVersion, _, publishedAt, availableUpdate, err := s.resolveAvailableVersion(context.Background())
	if err != nil {
		status.State = core.UpdateStateIdle
		status.UpdateAvailable = false
		status.AvailableUpdate = nil
		status.TargetVersion = ""
		status.FailureReason = err.Error()
		status.LastCheckedAt = time.Now().UTC()
		s.status = status
		return cloneStatus(status), err
	}

	status.LastCheckedAt = publishedAt
	if availableVersion == "" || !isVersionGreater(availableVersion, s.currentVersion) {
		status.State = core.UpdateStateIdle
		status.UpdateAvailable = false
		status.AvailableUpdate = nil
		status.TargetVersion = ""
		status.FailureReason = ""
		s.status = status
		return cloneStatus(status), nil
	}

	status.State = core.UpdateStateAvailable
	status.UpdateAvailable = true
	status.AvailableUpdate = availableUpdate
	status.TargetVersion = availableVersion
	status.FailureReason = ""
	s.status = status
	return cloneStatus(status), nil
}

func (s *Service) Apply() (core.UpdateStatus, error) {
	s.mu.Lock()

	status := cloneStatus(s.status)
	if !status.UpdateAvailable || status.AvailableUpdate == nil {
		s.mu.Unlock()
		return status, ErrNoUpdateAvailable
	}
	if status.UpdatePolicy != core.UpdatePolicySelfManaged {
		s.mu.Unlock()
		return status, ErrUpdateNotSelfManaged
	}
	switch status.State {
	case core.UpdateStateAvailable, core.UpdateStateReadyToApply, core.UpdateStateFailedPreExec:
	default:
		s.mu.Unlock()
		return status, ErrUpdateBusy
	}

	stagePath, err := s.downloadAndValidateUpdate(&status)
	if err != nil {
		status.State = core.UpdateStateFailedPreExec
		status.FailureReason = err.Error()
		s.status = status
		s.mu.Unlock()
		return cloneStatus(status), err
	}

	if err := runDoctorPreflight(stagePath); err != nil {
		status.State = core.UpdateStateFailedPreExec
		status.FailureReason = err.Error()
		s.status = status
		s.mu.Unlock()
		return cloneStatus(status), err
	}

	status.State = core.UpdateStateReexecing
	status.FailureReason = ""
	s.status = status
	s.mu.Unlock()

	go s.completeApply(stagePath)

	return cloneStatus(status), nil
}

func cloneStatus(status core.UpdateStatus) core.UpdateStatus {
	cloned := status
	if status.AvailableUpdate != nil {
		update := *status.AvailableUpdate
		cloned.AvailableUpdate = &update
	}
	return cloned
}

func resolveInstallSource(buildInstallSource string) core.InstallSource {
	if source := parseInstallSource(envValue("HOPTER_INSTALL_SOURCE")); source != "" {
		return source
	}
	if source := parseInstallSource(strings.TrimSpace(buildInstallSource)); source != "" {
		return source
	}
	return core.InstallSourceDirect
}

func parseInstallSource(raw string) core.InstallSource {
	switch strings.ToLower(raw) {
	case "direct":
		return core.InstallSourceDirect
	case "unknown":
		return core.InstallSourceUnknown
	case "homebrew_formula":
		return core.InstallSourceHomebrewFormula
	case "homebrew_cask":
		return core.InstallSourceHomebrewCask
	case "apt":
		return core.InstallSourceAPT
	case "dnf":
		return core.InstallSourceDNF
	case "winget":
		return core.InstallSourceWinget
	case "nix":
		return core.InstallSourceNix
	case "macports":
		return core.InstallSourceMacPorts
	case "snap":
		return core.InstallSourceSnap
	case "flatpak":
		return core.InstallSourceFlatpak
	default:
		return ""
	}
}

func policyForInstallSource(source core.InstallSource) core.UpdatePolicy {
	switch source {
	case core.InstallSourceSnap, core.InstallSourceFlatpak:
		return core.UpdatePolicyStoreManaged
	case core.InstallSourceHomebrewFormula, core.InstallSourceHomebrewCask, core.InstallSourceAPT, core.InstallSourceDNF, core.InstallSourceWinget, core.InstallSourceNix, core.InstallSourceMacPorts:
		return core.UpdatePolicyPackageManaged
	default:
		return core.UpdatePolicySelfManaged
	}
}

func commandHintForInstallSource(source core.InstallSource) string {
	switch source {
	case core.InstallSourceHomebrewFormula:
		return "brew upgrade hopter"
	case core.InstallSourceHomebrewCask:
		return "brew upgrade --cask hopter"
	case core.InstallSourceAPT:
		return "sudo apt update && sudo apt upgrade hopter"
	case core.InstallSourceDNF:
		return "sudo dnf upgrade hopter"
	case core.InstallSourceWinget:
		return "winget upgrade hopter"
	case core.InstallSourceNix:
		return "nix profile upgrade hopter"
	case core.InstallSourceMacPorts:
		return "sudo port selfupdate && sudo port upgrade hopter"
	case core.InstallSourceSnap:
		return "sudo snap refresh hopter"
	case core.InstallSourceFlatpak:
		return "flatpak update hopter"
	default:
		return ""
	}
}

func (s *Service) resolveAvailableVersion(ctx context.Context) (string, string, time.Time, *core.AvailableUpdate, error) {
	if manifestURL := updateManifestURL(); manifestURL != "" {
		payload, err := fetchManifest(ctx, s.httpClient, manifestURL)
		if err != nil {
			return "", "", time.Time{}, nil, err
		}
		if payload.Product != "hopter" {
			return "", "", time.Time{}, nil, fmt.Errorf("manifest product mismatch: %q", payload.Product)
		}
		if payload.Channel != "" && payload.Channel != s.channel {
			return "", "", time.Time{}, nil, fmt.Errorf("manifest channel mismatch: %q", payload.Channel)
		}

		artifact, ok := payload.Artifacts[currentPlatformKey()]
		if !ok {
			return "", "", time.Time{}, nil, fmt.Errorf("manifest missing artifact for platform %q", currentPlatformKey())
		}

		return payload.Version, payload.NotesURL, payload.PublishedAt, &core.AvailableUpdate{
			Version:              payload.Version,
			NotesURL:             payload.NotesURL,
			PublishedAt:          payload.PublishedAt,
			MinUpgradableVersion: payload.MinUpgradableVersion,
			ArtifactURL:          artifact.URL,
			SHA256:               artifact.SHA256,
			SizeBytes:            artifact.SizeBytes,
		}, nil
	}

	availableVersion := envValue("HOPTER_UPDATE_AVAILABLE_VERSION")
	notesURL := envValue("HOPTER_UPDATE_NOTES_URL")
	return availableVersion, notesURL, time.Now().UTC(), &core.AvailableUpdate{
		Version:     availableVersion,
		NotesURL:    notesURL,
		PublishedAt: time.Now().UTC(),
	}, nil
}

func updateManifestURL() string {
	if directURL := envValue("HOPTER_UPDATE_MANIFEST_URL"); directURL != "" {
		return directURL
	}
	baseURL := strings.TrimRight(envValue("HOPTER_UPDATE_BASE_URL"), "/")
	if baseURL == "" {
		return ""
	}
	return baseURL + "/update/v1/manifest.json"
}

func envValue(keys ...string) string {
	for _, key := range keys {
		if value := strings.TrimSpace(os.Getenv(key)); value != "" {
			return value
		}
	}
	return ""
}

func currentPlatformKey() string {
	return runtime.GOOS + "-" + runtime.GOARCH
}

func (s *Service) downloadAndValidateUpdate(status *core.UpdateStatus) (string, error) {
	if status.AvailableUpdate == nil {
		return "", ErrNoUpdateAvailable
	}
	if strings.TrimSpace(status.AvailableUpdate.ArtifactURL) == "" {
		return "", fmt.Errorf("available update is missing artifact URL")
	}
	if strings.TrimSpace(status.AvailableUpdate.SHA256) == "" {
		return "", fmt.Errorf("available update is missing artifact checksum")
	}

	stageDir, err := os.MkdirTemp("", "hopter-update-*")
	if err != nil {
		return "", fmt.Errorf("create staging directory: %w", err)
	}
	stagePath := filepath.Join(stageDir, "hopter")

	status.State = core.UpdateStateDownloading
	s.status = cloneStatus(*status)
	if err := downloadFile(s.httpClient, status.AvailableUpdate.ArtifactURL, stagePath); err != nil {
		return "", err
	}

	status.State = core.UpdateStateVerifying
	s.status = cloneStatus(*status)
	if err := verifySHA256(stagePath, status.AvailableUpdate.SHA256); err != nil {
		return "", err
	}

	return stagePath, nil
}

func (s *Service) completeApply(stagePath string) {
	if s.reexecDelay > 0 {
		time.Sleep(s.reexecDelay)
	}
	if err := s.reexec(stagePath); err != nil {
		s.mu.Lock()
		defer s.mu.Unlock()
		status := cloneStatus(s.status)
		status.State = core.UpdateStateFailedPreExec
		status.FailureReason = err.Error()
		s.status = status
	}
}

func downloadFile(client *http.Client, url string, dstPath string) error {
	resp, err := client.Get(url)
	if err != nil {
		return fmt.Errorf("download artifact: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return fmt.Errorf("download artifact: status %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	file, err := os.OpenFile(dstPath, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o755)
	if err != nil {
		return fmt.Errorf("open staging file: %w", err)
	}
	defer file.Close()

	if _, err := io.Copy(file, resp.Body); err != nil {
		return fmt.Errorf("write staging file: %w", err)
	}
	return nil
}

func verifySHA256(path string, expected string) error {
	file, err := os.Open(path)
	if err != nil {
		return fmt.Errorf("open staged artifact: %w", err)
	}
	defer file.Close()

	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return fmt.Errorf("hash staged artifact: %w", err)
	}

	actual := hex.EncodeToString(hash.Sum(nil))
	if !strings.EqualFold(actual, strings.TrimSpace(expected)) {
		return fmt.Errorf("artifact checksum mismatch: expected %s, got %s", strings.TrimSpace(expected), actual)
	}
	return nil
}

func runDoctorPreflight(binaryPath string) error {
	cmd := exec.Command(binaryPath, "doctor", "--json")
	output, err := cmd.CombinedOutput()

	var report struct {
		Checks []struct {
			Name   string `json:"name"`
			Status string `json:"status"`
			Detail string `json:"detail,omitempty"`
		} `json:"checks"`
	}
	if len(output) > 0 {
		if parseErr := json.Unmarshal(output, &report); parseErr != nil {
			if err != nil {
				return fmt.Errorf("doctor preflight failed: %w: %s", err, strings.TrimSpace(string(output)))
			}
			return fmt.Errorf("decode doctor preflight output: %w", parseErr)
		}
	}

	for _, check := range report.Checks {
		if strings.EqualFold(check.Status, "FAIL") {
			return fmt.Errorf("doctor preflight failed on %s: %s", check.Name, check.Detail)
		}
	}

	if err != nil {
		return fmt.Errorf("doctor preflight failed: %w", err)
	}
	return nil
}

func (s *Service) performReexec(stagePath string) error {
	currentPath, err := os.Executable()
	if err != nil {
		return fmt.Errorf("resolve current executable: %w", err)
	}
	if resolvedPath, resolveErr := filepath.EvalSymlinks(currentPath); resolveErr == nil {
		currentPath = resolvedPath
	}

	dir := filepath.Dir(currentPath)
	base := filepath.Base(currentPath)
	backupPath := filepath.Join(dir, "."+base+".bak")
	replacementPath := filepath.Join(dir, "."+base+".next")

	if err := copyFile(stagePath, replacementPath, 0o755); err != nil {
		return fmt.Errorf("stage replacement binary: %w", err)
	}
	_ = os.Remove(backupPath)
	if err := os.Rename(currentPath, backupPath); err != nil {
		_ = os.Remove(replacementPath)
		return fmt.Errorf("backup current binary: %w", err)
	}
	if err := os.Rename(replacementPath, currentPath); err != nil {
		_ = os.Rename(backupPath, currentPath)
		_ = os.Remove(replacementPath)
		return fmt.Errorf("replace current binary: %w", err)
	}

	if err := syscall.Exec(currentPath, os.Args, os.Environ()); err != nil {
		_ = os.Rename(currentPath, replacementPath)
		_ = os.Rename(backupPath, currentPath)
		_ = os.Remove(replacementPath)
		return fmt.Errorf("reexec new binary: %w", err)
	}
	return nil
}

func copyFile(srcPath, dstPath string, mode os.FileMode) error {
	src, err := os.Open(srcPath)
	if err != nil {
		return err
	}
	defer src.Close()

	dst, err := os.OpenFile(dstPath, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, mode)
	if err != nil {
		return err
	}
	defer dst.Close()

	if _, err := io.Copy(dst, src); err != nil {
		return err
	}
	return dst.Close()
}

func isVersionGreater(candidate, current string) bool {
	candidateParts, candidateOK := parseVersionParts(candidate)
	currentParts, currentOK := parseVersionParts(current)
	if !candidateOK || !currentOK {
		return candidate != "" && candidate != current
	}

	for i := 0; i < len(candidateParts) && i < len(currentParts); i++ {
		if candidateParts[i] > currentParts[i] {
			return true
		}
		if candidateParts[i] < currentParts[i] {
			return false
		}
	}
	return false
}

func parseVersionParts(version string) ([3]int, bool) {
	var parts [3]int
	trimmed := strings.TrimSpace(strings.TrimPrefix(version, "v"))
	chunks := strings.Split(trimmed, ".")
	if len(chunks) < 3 {
		return parts, false
	}
	for i := 0; i < 3; i++ {
		if chunks[i] == "" {
			return parts, false
		}
		value, err := strconv.Atoi(chunks[i])
		if err != nil {
			return parts, false
		}
		parts[i] = value
	}
	return parts, true
}
