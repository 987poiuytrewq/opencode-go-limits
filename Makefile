.PHONY: install format-check typecheck test test-unit ci

BUN ?= bun

install:
	$(BUN) install --frozen-lockfile

format-check:
	$(BUN) fmt --check package.json tsconfig.json .github/workflows/ci.yml src test

typecheck:
	$(BUN) ./node_modules/typescript/bin/tsc --noEmit

test-unit:
	$(BUN) test

test: format-check typecheck test-unit

ci: install test
