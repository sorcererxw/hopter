.PHONY: help dev start go-test go-run ui-dev ui-typecheck ui-build ui-lint proto proto-gen proto-lint test docs validate-go-idl validate-go-server validate-go-ui validate-go-tetris validate-all

help:
	@echo "Targets:"
	@echo "  dev                Run Vite + Go together; if either exits, both stop"
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
	@echo "  validate-go-tetris Run end-to-end Tetris proof"
	@echo "  validate-all       Run all current validations"

dev:
	bash scripts/dev.sh

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

validate-go-tetris:
	bun scripts/validate-go-tetris.ts

validate-all: docs validate-go-idl validate-go-server validate-go-ui validate-go-tetris
