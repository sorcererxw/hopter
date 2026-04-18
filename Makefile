.PHONY: help dev reset verify-live start go-test go-run ui-dev ui-typecheck ui-build ui-lint proto proto-gen proto-lint test docs validate-go-idl validate-go-server validate-go-ui validate-go-terminal validate-go-tetris validate-transcript-ui validate-session-roundtrip validate-app-server-runtime validate-app-server-approvals validate-interrupt-ui validate-update-ui validate-all

help:
	@echo "Targets:"
	@echo "  dev                Run the AI-first live loop with Vite, Go hot reload, and persistent logs"
	@echo "  reset              Stop stale listeners on 5173/8787 and clear tmp/air"
	@echo "  verify-live        Attach to the current dev loop and run a live smoke check"
	@echo "  start              Build UI, then run the Go server"
	@echo "  go-test            Run Go tests"
	@echo "  go-run             Run the Go server"
	@echo "  ui-dev             Start Vite dev server"
	@echo "  ui-typecheck       Run frontend typecheck"
	@echo "  ui-build           Build frontend dist"
	@echo "  ui-lint            Lint frontend"
	@echo "  proto-lint         Run buf lint"
	@echo "  proto-gen          Run buf generate"
	@echo "  proto              Run lint + generate"
	@echo "  test               Run rebuild helper tests"
	@echo "  docs               Run docs validation"
	@echo "  validate-go-idl    Run Go/IDL validation"
	@echo "  validate-go-server Run Go server validation"
	@echo "  validate-go-ui     Run Go UI validation"
	@echo "  validate-go-terminal Run Go terminal validation"
	@echo "  validate-go-tetris Run end-to-end Tetris proof"
	@echo "  validate-transcript-ui Run browser transcript rendering validation"
	@echo "  validate-session-roundtrip Run fresh-session + 4 follow-up Codex roundtrip validation"
	@echo "  validate-app-server-runtime Run SSE + reconcile + approval runtime validation"
	@echo "  validate-app-server-approvals Run approval probes by request type"
	@echo "  validate-interrupt-ui Run interrupt-button browser validation"
	@echo "  validate-update-ui Run update-entry browser validation"
	@echo "  validate-all       Run all current validations"

dev:
	bash scripts/dev.sh

reset:
	bash scripts/reset-dev.sh

verify-live:
	bun scripts/validate-live.ts

start: ui-build
	$(MAKE) go-run

go-test:
	go test ./...

go-run:
	go run ./cmd/orchd

ui-dev:
	pnpm --dir ui dev

ui-typecheck:
	pnpm --dir ui typecheck

ui-build:
	pnpm --dir ui build

ui-lint:
	pnpm --dir ui lint

proto-lint:
	cd idl && buf lint

proto-gen:
	cd idl && buf generate

proto: proto-lint proto-gen

test:
	bun test test/rebuild-validation.test.ts

docs:
	bun scripts/validate-docs.ts

validate-go-idl:
	bun scripts/validate-go-idl.ts

validate-go-server:
	bun scripts/validate-go-server.ts

validate-go-ui:
	bun scripts/validate-go-ui.ts

validate-go-terminal:
	bun scripts/validate-go-terminal.ts

validate-go-tetris:
	bun scripts/validate-go-tetris.ts

validate-transcript-ui:
	bun scripts/validate-transcript-ui.ts

validate-session-roundtrip:
	bun scripts/validate-session-roundtrip.ts

validate-app-server-runtime:
	bun scripts/validate-app-server-runtime.ts

validate-app-server-approvals:
	bun scripts/validate-app-server-approvals.ts

validate-interrupt-ui:
	bun scripts/validate-interrupt-ui.ts

validate-update-ui:
	bun scripts/validate-update-ui.ts

validate-all: docs validate-go-idl validate-go-server validate-go-ui validate-go-tetris
