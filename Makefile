.PHONY: clean build publish-to-npmjs

clean:
	rm -rf dist *.tgz

build: clean
	npm i && \
	npm run dev && \
	npm pack

publish-to-npmjs: clean
	npm run prod && \
	npm pack && \
	npm publish --access public
