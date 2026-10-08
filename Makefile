.PHONY: release

release:
	git diff --quiet && git diff --cached --quiet
	@read -p "Bump (patch/minor/major): " bump && npm version $$bump
	git push --follow-tags
	npm publish
	gh release create v$$(node -p "require('./package.json').version") --generate-notes
