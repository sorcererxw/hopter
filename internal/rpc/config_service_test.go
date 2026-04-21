package rpcserver

import (
	"context"
	"path/filepath"
	"testing"

	"connectrpc.com/connect"

	hopterv1 "github.com/sorcererxw/hopter/internal/gen/proto/hopter/v1"
	"github.com/sorcererxw/hopter/internal/userconfig"
)

func TestConfigServiceGetAndUpdateConfig(t *testing.T) {
	store, err := userconfig.NewService(filepath.Join(t.TempDir(), "config.json"), nil)
	if err != nil {
		t.Fatalf("NewService() error = %v", err)
	}
	service := NewConfigService(store)

	getResp, err := service.GetConfig(context.Background(), connect.NewRequest(&hopterv1.GetConfigRequest{}))
	if err != nil {
		t.Fatalf("GetConfig() error = %v", err)
	}
	if getResp.Msg.GetConfig().GetAppearance().GetTheme() != hopterv1.ConfigTheme_CONFIG_THEME_SYSTEM {
		t.Fatalf("initial theme = %v, want system", getResp.Msg.GetConfig().GetAppearance().GetTheme())
	}

	updateResp, err := service.UpdateConfig(context.Background(), connect.NewRequest(&hopterv1.UpdateConfigRequest{
		Appearance: &hopterv1.AppearanceConfig{
			Theme: hopterv1.ConfigTheme_CONFIG_THEME_DARK,
		},
		ExpectedRevision: getResp.Msg.GetConfig().GetRevision(),
	}))
	if err != nil {
		t.Fatalf("UpdateConfig() error = %v", err)
	}
	if updateResp.Msg.GetConfig().GetAppearance().GetTheme() != hopterv1.ConfigTheme_CONFIG_THEME_DARK {
		t.Fatalf("updated theme = %v, want dark", updateResp.Msg.GetConfig().GetAppearance().GetTheme())
	}
}

func TestConfigServiceRejectsRevisionConflict(t *testing.T) {
	store, err := userconfig.NewService(filepath.Join(t.TempDir(), "config.json"), nil)
	if err != nil {
		t.Fatalf("NewService() error = %v", err)
	}
	service := NewConfigService(store)

	_, err = service.UpdateConfig(context.Background(), connect.NewRequest(&hopterv1.UpdateConfigRequest{
		Appearance: &hopterv1.AppearanceConfig{
			Theme: hopterv1.ConfigTheme_CONFIG_THEME_LIGHT,
		},
		ExpectedRevision: store.Get().Revision + 1,
	}))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("UpdateConfig() code = %v, want %v (err=%v)", connect.CodeOf(err), connect.CodeFailedPrecondition, err)
	}
}
