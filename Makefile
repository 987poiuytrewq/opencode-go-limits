.PHONY: install format-check typecheck test test-unit test-integration test-e2e ci ci-tools verify-version e2e-debug

BUN ?= bun
OPENCODE_BIN ?= opencode
OPENCODE_VERSION ?=

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

# Opt-in: requires tmux and a real OpenCode binary. Uses an isolated HOME/XDG
# tree and a private tmux socket, so it never touches developer state.
test-e2e:
	@command -v tmux >/dev/null || { echo "tmux is required for E2E tests" >&2; exit 1; }
	@command -v "$(OPENCODE_BIN)" >/dev/null || { echo "OpenCode binary not found: $(OPENCODE_BIN)" >&2; exit 1; }
	@test -d node_modules || { echo "Run 'make install' before E2E tests" >&2; exit 1; }
	E2E=1 OPENCODE_BIN="$(OPENCODE_BIN)" $(BUN) test test/e2e

test: format-check typecheck test-unit test-integration

ci: install test

# CI-only host setup. The checks job stays host-free; the E2E matrix job
# installs tmux and the OpenCode version under test.
ci-tools:
	@test -n "$(OPENCODE_VERSION)" || { echo "OPENCODE_VERSION is required, for example: make ci-tools OPENCODE_VERSION=2.4.2" >&2; exit 1; }
	sudo apt-get update
	sudo apt-get install --yes tmux
	npm install --global @opencode/cli@$(OPENCODE_VERSION)

verify-version:
	@test -n "$(OPENCODE_VERSION)" || { echo "OPENCODE_VERSION is required" >&2; exit 1; }
	@version="$$($(OPENCODE_BIN) --version)"; \
	echo "$$version"; \
	case "$$version" in \
		*"$(OPENCODE_VERSION)"*) ;; \
		*) echo "Expected OpenCode $(OPENCODE_VERSION), found $$version" >&2; exit 1 ;; \
	esac

# Print artifacts preserved by a failed E2E run.
e2e-debug:
	@tmp="$${TMPDIR:-/tmp}"; tmp="$${tmp%/}/"; \
	found=0; \
	for dir in "$$tmp"opencode-go-limits-e2e-*; do \
		[ -d "$$dir" ] || continue; \
		found=1; \
		echo "=== E2E artifacts: $$dir ==="; \
		log="$$dir/home/.local/share/opencode/log/opencode.log"; \
		if [ -f "$$log" ]; then \
			echo "--- $$log (last 200 lines) ---"; \
			tail -n 200 "$$log"; \
		fi; \
	done; \
	[ "$$found" = 1 ] || echo "No preserved E2E artifacts under $$tmp"
