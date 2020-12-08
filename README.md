# StreamMachine client
```
npm i
```

## Build

### Run dev build

```bash
npm run dev
# or
npm run dev -- --watch
```

### Run prod build

```bash
npm run prod
```

## Example
Currently nothing is published yet, so for now additional steps are needed to run the example:

```bash
npm build
npm pack

cd examples/node
npm i 
npm i ../../streammachine-nodejs-driver-1.0.0.tgz

npm run sender
npm run receiver
```

### Local dev with example (beta)
It is possible to target your root dist folder directly from within the node example. This makes testing a lot easier
since you don't have to publish the package on every change.

```bash
cd examples/node
npm run link-root-dist # This links the root dist folder to npm instead of the installed package
npm run unlink-root-dist # This breaks the link to the root dist folder
```
