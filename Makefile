publish-to-npmjs:
	npm prod && \
	npm pack && \
	npm publish --access public
