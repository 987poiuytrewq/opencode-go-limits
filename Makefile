.PHONY: install format-check typecheck test test-unit test-integration ci

BUN ?= bun

install:
	$(BUN) install --frozen-lockfile

format-check:
	$(BUN) fmt --check package.json tsconfig.json bunfig.toml .github/workflows/ci.yml src test
	$(BUN) -e 'const readme = await Bun.file("README.md").text(); const match = readme.match(/```json\s*\n([\s\S]*?)\n\s*```/); if (!match) throw new Error("README strict JSON example not found"); JSON.parse(match[1])'

typecheck:
	$(BUN) ./node_modules/typescript/bin/tsc --noEmit

test-unit:
	$(BUN) test test/unit

test-integration:
	$(BUN) test test/integration

test: format-check typecheck test-unit test-integration

ci: install test
