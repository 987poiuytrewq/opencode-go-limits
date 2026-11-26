.PHONY: install format-check typecheck test test-unit test-integration ci

BUN ?= bun

install:
	$(BUN) install --frozen-lockfile

format-check:
	$(BUN) fmt --check package.json tsconfig.json bunfig.toml .github/workflows/ci.yml src test

typecheck:
	$(BUN) ./node_modules/typescript/bin/tsc --noEmit

test-unit:
	$(BUN) test test/unit

test-integration:
	$(BUN) test test/integration

test: format-check typecheck test-unit test-integration

ci: install test
