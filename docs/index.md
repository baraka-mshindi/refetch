---
layout: home

hero:
  name: refetch
  text: An HTTP client on native fetch
  tagline: Result objects instead of exceptions, typed errors, retry, schema validation and streaming. Zero runtime dependencies.
  actions:
    - theme: brand
      text: Read the guide
      link: /guide/
    - theme: alt
      text: Compare with ky, ofetch and others
      link: /guide/comparison

features:
  - title: Failures are values
    details: Every call resolves to a response with ok, problem and a discriminated error. Opt into throwing with throwOnError or unwrap() where a rejection suits better.
  - title: Validated, typed data
    details: Pass a Zod, Valibot or ArkType schema and data is checked at the boundary and typed from the schema.
  - title: Retry and timeouts that behave
    details: Per-attempt and total timeouts, Retry-After support, back-off with jitter, and cancels that are never retried.
  - title: Streaming for LLM workloads
    details: POST and read Server-Sent Events or NDJSON as an async iterable from the /stream sub-path.
  - title: Safe defaults
    details: Bearer tokens stay on your API's origin, responses can be size-capped, and credentials are kept out of logs and error reports.
  - title: Runs everywhere fetch does
    details: Node, Bun, Deno, browsers and workers. ESM and CJS, tree-shakeable sub-paths.
---
