package rpcserver

import (
	"context"
	"errors"
	"fmt"

	"connectrpc.com/connect"

	hopterv1 "github.com/sorcererxw/hopter/internal/gen/proto/hopter/v1"
	"github.com/sorcererxw/hopter/internal/userconfig"
)

type ConfigService struct {
	config *userconfig.Service
}

func NewConfigService(config *userconfig.Service) *ConfigService {
	return &ConfigService{config: config}
}

func (s *ConfigService) GetConfig(_ context.Context, _ *connect.Request[hopterv1.GetConfigRequest]) (*connect.Response[hopterv1.GetConfigResponse], error) {
	if s.config == nil {
		return nil, connect.NewError(connect.CodeUnimplemented, errors.New("config service unavailable"))
	}

	return connect.NewResponse(&hopterv1.GetConfigResponse{
		Config: configToProto(s.config.Get()),
	}), nil
}

func (s *ConfigService) UpdateConfig(_ context.Context, req *connect.Request[hopterv1.UpdateConfigRequest]) (*connect.Response[hopterv1.UpdateConfigResponse], error) {
	if s.config == nil {
		return nil, connect.NewError(connect.CodeUnimplemented, errors.New("config service unavailable"))
	}

	patch, err := configPatchFromProto(req.Msg)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}
	cfg, err := s.config.Update(patch)
	if err != nil {
		if errors.Is(err, userconfig.ErrRevisionConflict) {
			return nil, connect.NewError(connect.CodeFailedPrecondition, err)
		}
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}

	return connect.NewResponse(&hopterv1.UpdateConfigResponse{
		Config: configToProto(cfg),
	}), nil
}

func configPatchFromProto(req *hopterv1.UpdateConfigRequest) (userconfig.Patch, error) {
	if req == nil {
		return userconfig.Patch{}, nil
	}

	patch := userconfig.Patch{
		ExpectedRevision: req.GetExpectedRevision(),
	}
	if appearance := req.GetAppearance(); appearance != nil {
		theme, err := themeFromProto(appearance.GetTheme())
		if err != nil {
			return userconfig.Patch{}, err
		}
		locale, err := localeFromProto(appearance.GetLocale())
		if err != nil {
			return userconfig.Patch{}, err
		}
		patch.Appearance = &userconfig.AppearanceConfig{
			Theme:  theme,
			Locale: locale,
		}
	}
	if agent := req.GetAgent(); agent != nil {
		patch.Agent = &userconfig.AgentConfig{
			DefaultBackend:         agent.GetDefaultBackend(),
			DefaultModel:           agent.GetDefaultModel(),
			DefaultReasoningEffort: agent.GetDefaultReasoningEffort(),
			DefaultCodexFastMode:   agent.GetDefaultCodexFastMode(),
		}
	}
	if composer := req.GetComposer(); composer != nil {
		sendShortcut, err := composerSendShortcutFromProto(composer.GetSendShortcut())
		if err != nil {
			return userconfig.Patch{}, err
		}
		patch.Composer = &userconfig.ComposerConfig{
			SendShortcut: sendShortcut,
		}
	}
	return patch, nil
}

func configToProto(cfg userconfig.Config) *hopterv1.UserConfig {
	return &hopterv1.UserConfig{
		Appearance: &hopterv1.AppearanceConfig{
			Theme:  themeToProto(cfg.Appearance.Theme),
			Locale: localeToProto(cfg.Appearance.Locale),
		},
		Agent: &hopterv1.AgentConfig{
			DefaultBackend:         cfg.Agent.DefaultBackend,
			DefaultModel:           cfg.Agent.DefaultModel,
			DefaultReasoningEffort: cfg.Agent.DefaultReasoningEffort,
			DefaultCodexFastMode:   cfg.Agent.DefaultCodexFastMode,
		},
		Composer: &hopterv1.ComposerConfig{
			SendShortcut: composerSendShortcutToProto(cfg.Composer.SendShortcut),
		},
		Revision:  cfg.Revision,
		UpdatedAt: timestamp(cfg.UpdatedAt),
	}
}

func composerSendShortcutToProto(shortcut userconfig.ComposerSendShortcut) hopterv1.ConfigComposerSendShortcut {
	switch shortcut {
	case userconfig.ComposerSendShortcutEnter:
		return hopterv1.ConfigComposerSendShortcut_CONFIG_COMPOSER_SEND_SHORTCUT_ENTER
	case userconfig.ComposerSendShortcutCmdEnter:
		return hopterv1.ConfigComposerSendShortcut_CONFIG_COMPOSER_SEND_SHORTCUT_CMD_ENTER
	default:
		return hopterv1.ConfigComposerSendShortcut_CONFIG_COMPOSER_SEND_SHORTCUT_CMD_ENTER
	}
}

func composerSendShortcutFromProto(shortcut hopterv1.ConfigComposerSendShortcut) (userconfig.ComposerSendShortcut, error) {
	switch shortcut {
	case hopterv1.ConfigComposerSendShortcut_CONFIG_COMPOSER_SEND_SHORTCUT_CMD_ENTER, hopterv1.ConfigComposerSendShortcut_CONFIG_COMPOSER_SEND_SHORTCUT_UNSPECIFIED:
		return userconfig.ComposerSendShortcutCmdEnter, nil
	case hopterv1.ConfigComposerSendShortcut_CONFIG_COMPOSER_SEND_SHORTCUT_ENTER:
		return userconfig.ComposerSendShortcutEnter, nil
	default:
		return "", fmt.Errorf("unsupported composer send shortcut %v", shortcut)
	}
}

func localeToProto(locale userconfig.Locale) hopterv1.ConfigLocale {
	switch locale {
	case userconfig.LocaleEN:
		return hopterv1.ConfigLocale_CONFIG_LOCALE_EN
	case userconfig.LocaleZhCN:
		return hopterv1.ConfigLocale_CONFIG_LOCALE_ZH_CN
	case userconfig.LocaleSystem:
		return hopterv1.ConfigLocale_CONFIG_LOCALE_SYSTEM
	default:
		return hopterv1.ConfigLocale_CONFIG_LOCALE_SYSTEM
	}
}

func localeFromProto(locale hopterv1.ConfigLocale) (userconfig.Locale, error) {
	switch locale {
	case hopterv1.ConfigLocale_CONFIG_LOCALE_SYSTEM, hopterv1.ConfigLocale_CONFIG_LOCALE_UNSPECIFIED:
		return userconfig.LocaleSystem, nil
	case hopterv1.ConfigLocale_CONFIG_LOCALE_EN:
		return userconfig.LocaleEN, nil
	case hopterv1.ConfigLocale_CONFIG_LOCALE_ZH_CN:
		return userconfig.LocaleZhCN, nil
	default:
		return "", fmt.Errorf("unsupported locale %v", locale)
	}
}

func themeToProto(theme userconfig.Theme) hopterv1.ConfigTheme {
	switch theme {
	case userconfig.ThemeDark:
		return hopterv1.ConfigTheme_CONFIG_THEME_DARK
	case userconfig.ThemeLight:
		return hopterv1.ConfigTheme_CONFIG_THEME_LIGHT
	case userconfig.ThemeSystem:
		return hopterv1.ConfigTheme_CONFIG_THEME_SYSTEM
	default:
		return hopterv1.ConfigTheme_CONFIG_THEME_SYSTEM
	}
}

func themeFromProto(theme hopterv1.ConfigTheme) (userconfig.Theme, error) {
	switch theme {
	case hopterv1.ConfigTheme_CONFIG_THEME_SYSTEM, hopterv1.ConfigTheme_CONFIG_THEME_UNSPECIFIED:
		return userconfig.ThemeSystem, nil
	case hopterv1.ConfigTheme_CONFIG_THEME_DARK:
		return userconfig.ThemeDark, nil
	case hopterv1.ConfigTheme_CONFIG_THEME_LIGHT:
		return userconfig.ThemeLight, nil
	default:
		return "", fmt.Errorf("unsupported theme %v", theme)
	}
}
