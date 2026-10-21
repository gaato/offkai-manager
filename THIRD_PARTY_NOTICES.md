# Third-Party Notices

This repository and its release artifacts contain third-party material. The
offkai-manager project does not relicense that material under
AGPL-3.0-or-later; each component remains under its original terms.

## Scope and generation method

The npm inventory below was regenerated on 2026-10-21 from the frozen
`pnpm-lock.yaml` production graph with pnpm 11.9.0:

```fish
pnpm install --frozen-lockfile
pnpm licenses list --prod --long --json
```

The JSON result was normalized by package name, version, declared SPDX license,
and upstream homepage. It contains 122 package names and 123 package releases
(`real-require` occurs at two versions), including production optional and
peer packages selected by pnpm for Linux x86-64. Exact copyright notices and
license files remain in the installed package directories under
`node_modules`; the production container carries those directories unchanged.

The inventory does not treat all development dependencies as shipped runtime
material. Build tools whose source or generated output is incorporated into the
application and third-party skill files distributed in the
source tree are recorded separately after the pnpm inventory.

The runtime image is based on
[`node:26.12.0-slim`](https://github.com/nodejs/docker-node). Node.js license
material remains at `/usr/local/LICENSE`; Debian package notices remain under
`/usr/share/doc/*/copyright` in the image.

## pnpm production dependency inventory

### (MIT OR CC0-1.0)

- [`type-fest` 2.19.0](https://github.com/sindresorhus/type-fest#readme)

### Apache-2.0

- [`aria-query` 5.3.1](https://github.com/A11yance/aria-query#readme)
- [`axobject-query` 4.1.0](https://github.com/A11yance/axobject-query#readme)
- [`detect-libc` 2.1.2](https://github.com/lovell/detect-libc#readme)
- [`drizzle-orm` 0.45.4](https://orm.drizzle.team)
- [`typescript` 5.9.3](https://www.typescriptlang.org/)

### BSD-3-Clause

- [`@hapi/hoek` 9.3.0](https://github.com/hapijs/hoek#readme)
- [`@hapi/topo` 5.1.0](https://github.com/hapijs/topo#readme)
- [`@sideway/address` 4.1.5](https://github.com/sideway/address#readme)
- [`@sideway/formula` 3.0.1](https://github.com/sideway/formula#readme)
- [`@sideway/pinpoint` 2.0.0](https://github.com/sideway/pinpoint#readme)
- [`joi` 17.13.4](https://github.com/hapijs/joi#readme)
- [`source-map-js` 1.2.1](https://github.com/7rulnik/source-map-js)

### ISC

- [`@lucide/svelte` 1.25.0](https://lucide.dev)
- [`memoize-weak` 1.0.2](https://github.com/timkendrick/memoize-weak#readme)
- [`picocolors` 1.1.1](https://github.com/alexeyraspopov/picocolors#readme)
- [`split2` 4.2.0](https://github.com/mcollina/split2#readme)
- [`ts-deepmerge` 8.0.0](https://github.com/voodoocreation/ts-deepmerge#readme)
- [`yaml` 2.9.0](https://eemeli.org/yaml/)
- [`zod-v3-to-json-schema` 4.0.0](https://github.com/StefanTerdell/zod-to-json-schema#readme)

### MIT

- [`@ark/schema` 0.56.2](https://github.com/arktypeio/arktype#readme)
- [`@ark/util` 0.56.2](https://www.npmjs.com/package/@ark/util)
- [`@babel/runtime` 7.29.7](https://babel.dev/docs/en/next/babel-runtime)
- [`@date-fns/tz` 1.5.0](https://github.com/date-fns/date-fns#readme)
- [`@esbuild/linux-x64` 0.28.1](https://github.com/evanw/esbuild#readme)
- [`@exodus/schemasafe` 1.3.0](https://github.com/ExodusMovement/schemasafe)
- [`@jridgewell/gen-mapping` 0.3.13](https://github.com/jridgewell/sourcemaps/tree/main/packages/gen-mapping)
- [`@jridgewell/remapping` 2.3.5](https://github.com/jridgewell/sourcemaps/tree/main/packages/remapping)
- [`@jridgewell/resolve-uri` 3.1.2](https://github.com/jridgewell/resolve-uri#readme)
- [`@jridgewell/sourcemap-codec` 1.5.5](https://github.com/jridgewell/sourcemaps/tree/main/packages/sourcemap-codec)
- [`@jridgewell/trace-mapping` 0.3.31](https://github.com/jridgewell/sourcemaps/tree/main/packages/trace-mapping)
- [`@pinojs/redact` 0.4.0](https://github.com/pinojs/redact#readme)
- [`@polka/url` 1.0.0-next.29](https://github.com/lukeed/polka#readme)
- [`@poppinss/macroable` 1.1.2](https://github.com/poppinss/macroable#readme)
- [`@rollup/rollup-linux-x64-gnu` 4.62.2](https://rollupjs.org/)
- [`@standard-schema/spec` 1.1.0](https://standardschema.dev)
- [`@sveltejs/acorn-typescript` 1.0.11](https://github.com/sveltejs/acorn-typescript#readme)
- [`@sveltejs/kit` 2.70.0](https://svelte.dev)
- [`@sveltejs/vite-plugin-svelte` 6.2.4](https://github.com/sveltejs/vite-plugin-svelte#readme)
- [`@sveltejs/vite-plugin-svelte-inspector` 5.0.2](https://github.com/sveltejs/vite-plugin-svelte#readme)
- [`@types/better-sqlite3` 7.6.13](https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/better-sqlite3)
- [`@types/cookie` 0.6.0](https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/cookie)
- [`@types/estree` 1.0.9](https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/estree)
- [`@types/json-schema` 7.0.15](https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/json-schema)
- [`@types/node` 26.6.5](https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/node)
- [`@types/trusted-types` 2.0.7](https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/trusted-types)
- [`@types/validator` 13.15.10](https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/validator)
- [`@typeschema/class-validator` 0.3.0](https://typeschema.com)
- [`@typeschema/core` 0.14.0](https://typeschema.com)
- [`@typescript-eslint/types` 8.64.0](https://typescript-eslint.io)
- [`@valibot/to-json-schema` 1.7.1](https://valibot.dev)
- [`@vinejs/compiler` 3.0.0](https://github.com/vinejs/compiler#readme)
- [`@vinejs/vine` 3.0.1](https://github.com/vinejs/vine#readme)
- [`acorn` 8.17.0](https://github.com/acornjs/acorn)
- [`arkregex` 0.0.8](https://www.npmjs.com/package/arkregex)
- [`arktype` 2.2.3](https://github.com/arktypeio/arktype#readme)
- [`atomic-sleep` 1.0.0](https://github.com/davidmarkclements/atomic-sleep#readme)
- [`better-sqlite3` 13.0.3](http://github.com/WiseLibs/better-sqlite3)
- [`camelcase` 8.0.0](https://github.com/sindresorhus/camelcase#readme)
- [`class-validator` 0.14.4](https://github.com/typestack/class-validator#readme)
- [`clsx` 2.1.1](https://github.com/lukeed/clsx#readme)
- [`cookie` 0.6.0](https://github.com/jshttp/cookie#readme)
- [`dayjs` 1.11.21](https://day.js.org)
- [`deepmerge` 4.3.1](https://github.com/TehShrike/deepmerge)
- [`devalue` 5.8.1](https://github.com/sveltejs/devalue#readme)
- [`dlv` 1.1.3](https://github.com/developit/dlv#readme)
- [`effect` 3.22.0](https://effect.website)
- [`esbuild` 0.28.1](https://github.com/evanw/esbuild#readme)
- [`esm-env` 1.2.2](https://github.com/benmccann/esm-env)
- [`esrap` 2.2.13](https://github.com/sveltejs/esrap#readme)
- [`fast-check` 3.23.2](https://fast-check.dev/)
- [`fdir` 6.5.0](https://github.com/thecodrr/fdir#readme)
- [`is-reference` 3.0.3](https://github.com/Rich-Harris/is-reference#readme)
- [`jiti` 2.7.0](https://github.com/unjs/jiti#readme)
- [`json-schema-to-ts` 3.1.1](https://github.com/ThomasAribart/json-schema-to-ts#readme)
- [`kleur` 4.1.5](https://github.com/lukeed/kleur#readme)
- [`libphonenumber-js` 1.13.9](https://gitlab.com/catamphetamine/libphonenumber-js#readme)
- [`locate-character` 3.0.0](https://gitlab.com/Rich-Harris/locate-character#README)
- [`magic-string` 0.30.21](https://github.com/Rich-Harris/magic-string#readme)
- [`mrmime` 2.0.1](https://github.com/lukeed/mrmime#readme)
- [`nanoid` 3.3.16](https://github.com/ai/nanoid#readme)
- [`node-addon-api` 8.9.2](https://github.com/nodejs/node-addon-api)
- [`normalize-url` 8.1.1](https://github.com/sindresorhus/normalize-url#readme)
- [`obug` 2.1.4](https://github.com/sxzz/obug#readme)
- [`on-exit-leak-free` 2.1.2](https://github.com/mcollina/on-exit-or-gc#readme)
- [`picomatch` 4.0.5](https://github.com/micromatch/picomatch)
- [`pino` 10.3.1](https://getpino.io)
- [`pino-abstract-transport` 3.0.0](https://github.com/pinojs/pino-abstract-transport#readme)
- [`pino-std-serializers` 7.1.0](https://github.com/pinojs/pino-std-serializers#readme)
- [`postcss` 8.5.19](https://postcss.org/)
- [`process-warning` 5.0.0](https://github.com/fastify/fastify-warning#readme)
- [`property-expr` 2.0.6](https://github.com/jquense/expr#readme)
- [`pure-rand` 6.1.0](https://github.com/dubzzz/pure-rand#readme)
- [`quick-format-unescaped` 4.0.4](https://github.com/davidmarkclements/quick-format#readme)
- [`real-require` 0.2.0, 1.0.0](https://github.com/pinojs/real-require)
- [`rollup` 4.62.2](https://rollupjs.org/)
- [`safe-stable-stringify` 2.5.0](https://github.com/BridgeAR/safe-stable-stringify#readme)
- [`set-cookie-parser` 3.1.2](https://github.com/nfriedly/set-cookie-parser)
- [`sirv` 3.0.2](https://github.com/lukeed/sirv#readme)
- [`sonic-boom` 4.2.1](https://github.com/pinojs/sonic-boom#readme)
- [`stripe` 23.0.0](https://github.com/stripe/stripe-node)
- [`superstruct` 2.0.2](https://github.com/ianstormtaylor/superstruct#readme)
- [`svelte` 5.56.6](https://svelte.dev)
- [`sveltekit-superforms` 2.30.2](https://superforms.rocks)
- [`thread-stream` 4.2.0](https://github.com/mcollina/thread-stream#readme)
- [`tiny-case` 1.0.3](https://github.com/jquense/tiny-case#readme)
- [`tinyglobby` 0.2.17](https://superchupu.dev/tinyglobby)
- [`toposort` 2.0.2](https://github.com/marcelklehr/toposort#readme)
- [`totalist` 3.0.1](https://github.com/lukeed/totalist#readme)
- [`ts-algebra` 2.0.0](https://github.com/ThomasAribart/ts-algebra#readme)
- [`tsx` 4.23.1](https://tsx.hirok.io)
- [`typebox` 1.3.6](https://github.com/sinclairzx81/typebox#readme)
- [`undici-types` 8.9.0](https://undici.nodejs.org)
- [`valibot` 1.4.2](https://valibot.dev)
- [`validator` 13.15.35](https://github.com/validatorjs/validator.js)
- [`vite` 7.3.6](https://vite.dev)
- [`vitefu` 1.1.3](https://github.com/svitejs/vitefu#readme)
- [`yup` 1.7.1](https://github.com/jquense/yup)
- [`zimmerframe` 1.1.4](https://github.com/sveltejs/zimmerframe#readme)
- [`zod` 4.4.3](https://zod.dev)

### MPL-2.0

- [`lightningcss` 1.32.0](https://github.com/parcel-bundler/lightningcss#readme)
- [`lightningcss-linux-x64-gnu` 1.32.0](https://github.com/parcel-bundler/lightningcss#readme)

## Bundled and vendored material outside the production dependency graph

- [`@sveltejs/adapter-node` 5.5.7](https://github.com/sveltejs/kit/tree/main/packages/adapter-node)
  is used at build time and contributes the production Node server wrapper.
- [Tailwind CSS 4.3.3](https://github.com/tailwindlabs/tailwindcss) generates the
  application stylesheet.
- [DaisyUI 5.7.50](https://github.com/saadeghi/daisyui) is a Tailwind build-time
  plugin; its built-in component and light/dark theme CSS is included in the application stylesheet.
- [samber/cc-skills-golang v1.7.0](https://github.com/samber/cc-skills-golang)
  supplied selected files under `.agents/skills`. They are distributed in the
  source tree and are not included in the runtime image.
- [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills) supplied
  `.agents/skills/documentation-and-adrs`. The source snapshot is distributed
  in the repository and is not included in the runtime image.

The material in this section is licensed under the MIT License with these
copyright notices:

```text
Copyright (c) Tailwind Labs, Inc.
Copyright (c) 2020 Pouya Saadeghi
Copyright (c) 2020 [these people](https://github.com/sveltejs/kit/graphs/contributors)
Copyright (c) 2026 Samuel Berthe
Copyright (c) 2025 Addy Osmani
```

```text
MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
