.PHONY: release

SHELL := /bin/bash

release:
	@set -euo pipefail; \
	version() { node -p "require('./package.json').version"; }; \
	npm whoami >/dev/null; \
	test "$$(git branch --show-current)" = main; \
	test -z "$$(git status --porcelain)"; \
	git fetch origin main; \
	if git tag --points-at HEAD | grep -qx "v$$(version)"; then \
		echo "Resuming release of v$$(version)"; \
	else \
		test "$$(git rev-parse HEAD)" = "$$(git rev-parse origin/main)"; \
		npm pack --dry-run; \
		read -p "Bump (patch/minor/major): " bump; \
		npm version "$$bump"; \
	fi; \
	v=$$(version); \
	git push --follow-tags; \
	if npm view "pi-reply-guard@$$v" version 2>/dev/null | grep -q .; then echo "npm already has $$v"; else npm publish; fi; \
	if gh release view "v$$v" >/dev/null 2>&1; then echo "GitHub release v$$v exists"; else gh release create "v$$v" --generate-notes; fi
