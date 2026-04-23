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
	if getResp.Msg.GetConfig().GetAppearance().GetLocale() != hopterv1.ConfigLocale_CONFIG_LOCALE_SYSTEM {
		t.Fatalf("initial locale = %v, want system", getResp.Msg.GetConfig().GetAppearance().GetLocale())
	}
	if getResp.Msg.GetConfig().GetComposer().GetSendShortcut() != hopterv1.ConfigComposerSendShortcut_CONFIG_COMPOSER_SEND_SHORTCUT_CMD_ENTER {
		t.Fatalf("initial composer shortcut = %v, want cmd-enter", getResp.Msg.GetConfig().GetComposer().GetSendShortcut())
	}

	updateResp, err := service.UpdateConfig(context.Background(), connect.NewRequest(&hopterv1.UpdateConfigRequest{
		Appearance: &hopterv1.AppearanceConfig{
			Theme:  hopterv1.ConfigTheme_CONFIG_THEME_DARK,
			Locale: hopterv1.ConfigLocale_CONFIG_LOCALE_ZH_CN,
		},
		Composer: &hopterv1.ComposerConfig{
			SendShortcut: hopterv1.ConfigComposerSendShortcut_CONFIG_COMPOSER_SEND_SHORTCUT_ENTER,
		},
		ExpectedRevision: getResp.Msg.GetConfig().GetRevision(),
	}))
	if err != nil {
		t.Fatalf("UpdateConfig() error = %v", err)
	}
	if updateResp.Msg.GetConfig().GetAppearance().GetTheme() != hopterv1.ConfigTheme_CONFIG_THEME_DARK {
		t.Fatalf("updated theme = %v, want dark", updateResp.Msg.GetConfig().GetAppearance().GetTheme())
	}
	if updateResp.Msg.GetConfig().GetAppearance().GetLocale() != hopterv1.ConfigLocale_CONFIG_LOCALE_ZH_CN {
		t.Fatalf("updated locale = %v, want zh-CN", updateResp.Msg.GetConfig().GetAppearance().GetLocale())
	}
	if updateResp.Msg.GetConfig().GetComposer().GetSendShortcut() != hopterv1.ConfigComposerSendShortcut_CONFIG_COMPOSER_SEND_SHORTCUT_ENTER {
		t.Fatalf("updated composer shortcut = %v, want enter", updateResp.Msg.GetConfig().GetComposer().GetSendShortcut())
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
			Theme:  hopterv1.ConfigTheme_CONFIG_THEME_LIGHT,
			Locale: hopterv1.ConfigLocale_CONFIG_LOCALE_EN,
		},
		ExpectedRevision: store.Get().Revision + 1,
	}))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("UpdateConfig() code = %v, want %v (err=%v)", connect.CodeOf(err), connect.CodeFailedPrecondition, err)
	}
}
