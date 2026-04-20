package update

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/sorcererxw/hopter/internal/core"
)

const defaultReleaseRepository = "sorcererxw/hopter"
const defaultGitHubAPIBaseURL = "https://api.github.com"

type githubReleaseResponse struct {
	TagName     string               `json:"tag_name"`
	HTMLURL     string               `json:"html_url"`
	PublishedAt time.Time            `json:"published_at"`
	Assets      []githubReleaseAsset `json:"assets"`
}

type githubReleaseAsset struct {
	Name               string `json:"name"`
	BrowserDownloadURL string `json:"browser_download_url"`
	Size               int64  `json:"size"`
}

func fetchLatestGitHubRelease(ctx context.Context, client *http.Client, repo string, selfManaged bool) (*core.AvailableUpdate, error) {
	apiBaseURL := strings.TrimRight(envValue("HOPTER_UPDATE_GITHUB_API_BASE_URL"), "/")
	if apiBaseURL == "" {
		apiBaseURL = defaultGitHubAPIBaseURL
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, apiBaseURL+"/repos/"+repo+"/releases/latest", nil)
	if err != nil {
		return nil, fmt.Errorf("build github latest release request: %w", err)
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "hopter-update-check")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("fetch github latest release: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return nil, fmt.Errorf("fetch github latest release: status %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	var release githubReleaseResponse
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&release); err != nil {
		return nil, fmt.Errorf("decode github latest release: %w", err)
	}
	if strings.TrimSpace(release.TagName) == "" {
		return nil, fmt.Errorf("github latest release is missing tag_name")
	}

	update := &core.AvailableUpdate{
		Version:     strings.TrimSpace(release.TagName),
		NotesURL:    strings.TrimSpace(release.HTMLURL),
		PublishedAt: release.PublishedAt,
	}

	platformAssetName := "hopter-" + currentPlatformKey()
	platformAsset, platformAssetFound := findReleaseAsset(release.Assets, platformAssetName)
	if platformAssetFound {
		update.ArtifactURL = strings.TrimSpace(platformAsset.BrowserDownloadURL)
		update.SizeBytes = platformAsset.Size
	}

	checksumAsset, checksumAssetFound := findReleaseAsset(release.Assets, "checksums.txt")
	if checksumAssetFound && platformAssetFound {
		checksum, err := fetchChecksumForAsset(ctx, client, checksumAsset.BrowserDownloadURL, platformAsset.Name)
		if err != nil {
			return nil, err
		}
		update.SHA256 = checksum
	}

	if selfManaged {
		if !platformAssetFound {
			return nil, fmt.Errorf("github latest release is missing asset %q", platformAssetName)
		}
		if update.SHA256 == "" {
			if !checksumAssetFound {
				return nil, fmt.Errorf("github latest release is missing checksums.txt")
			}
			return nil, fmt.Errorf("github latest release checksum entry missing for %q", platformAssetName)
		}
	}

	return update, nil
}

func findReleaseAsset(assets []githubReleaseAsset, name string) (githubReleaseAsset, bool) {
	for _, asset := range assets {
		if strings.TrimSpace(asset.Name) == name {
			return asset, true
		}
	}
	return githubReleaseAsset{}, false
}

func fetchChecksumForAsset(ctx context.Context, client *http.Client, checksumsURL string, assetName string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, checksumsURL, nil)
	if err != nil {
		return "", fmt.Errorf("build checksum request: %w", err)
	}
	req.Header.Set("User-Agent", "hopter-update-check")

	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("fetch checksums: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return "", fmt.Errorf("fetch checksums: status %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return "", fmt.Errorf("read checksums: %w", err)
	}

	for _, line := range strings.Split(string(body), "\n") {
		fields := strings.Fields(strings.TrimSpace(line))
		if len(fields) < 2 {
			continue
		}
		if fields[len(fields)-1] == assetName {
			return fields[0], nil
		}
	}
	return "", nil
}

func updateReleaseRepository() string {
	repo := strings.TrimSpace(envValue("HOPTER_UPDATE_RELEASE_REPO"))
	if repo != "" {
		return repo
	}
	return defaultReleaseRepository
}
