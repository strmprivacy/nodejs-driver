publish-to-npmjs:
	npm run prod && \
	npm pack && \
	npm publish --access public
