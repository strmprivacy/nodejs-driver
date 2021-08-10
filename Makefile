.PHONY: build publish-to-npmjs

build:
	npm i && \
	npm run dev && \
	npm pack

publish-to-npmjs:
	npm run prod && \
	npm pack && \
	npm publish --access public
