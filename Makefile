.PHONY: release

release:
	test "$$(git branch --show-current)" = main
	test -z "$$(git status --porcelain)"
	git fetch origin main
	test "$$(git rev-parse HEAD)" = "$$(git rev-parse origin/main)"
	@read -p "Bump (patch/minor/major): " bump && npm version $$bump
	git push --follow-tags
	npm publish
	gh release create v$$(node -p "require('./package.json').version") --generate-notes
