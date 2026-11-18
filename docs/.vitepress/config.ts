import { defineConfig } from 'vitepress';

const repo = 'https://github.com/baraka-mshindi/refetch';

// The guide is written in docs/guide. The security policy and the changelog are included from
// SECURITY.md and CHANGELOG.md at the repository root, so those two cannot drift from the site.
export default defineConfig({
  title: 'refetch',
  description:
    'A production-grade HTTP client on native fetch: result objects, typed errors, retry, schema validation, streaming.',
  // Served as a GitHub Pages project site.
  base: '/refetch/',
  cleanUrls: true,
  lastUpdated: true,
  markdown: {
    // Release notes are generated from commit messages and can contain generics such as
    // ApiResponse<T> outside code spans. Vue would read <T> as an unclosed element and fail the
    // build, so inline HTML is rendered as text. Block HTML (comments) is unaffected.
    config(md) {
      md.renderer.rules.html_inline = (tokens, index) => md.utils.escapeHtml(tokens[index].content);
    },
  },
  themeConfig: {
    nav: [
      { text: 'Guide', link: '/guide/' },
      { text: 'Comparison', link: '/guide/comparison' },
      { text: 'Migration', link: '/guide/migration' },
      { text: 'Changelog', link: '/changelog' },
    ],
    sidebar: [
      {
        text: 'Guide',
        items: [
          { text: 'Getting started', link: '/guide/' },
          { text: 'Error handling', link: '/guide/errors' },
          { text: 'Interceptors and monitors', link: '/guide/interceptors' },
          { text: 'Retry, timeouts and cancellation', link: '/guide/retry-timeouts' },
          { text: 'Streaming and progress', link: '/guide/streaming' },
          { text: 'Middleware and instances', link: '/guide/instances' },
          { text: 'Bodies, parsing and validation', link: '/guide/bodies' },
          { text: 'TypeScript and integrations', link: '/guide/typescript' },
          { text: 'Security', link: '/guide/security' },
        ],
      },
      {
        text: 'Project',
        items: [
          { text: 'Comparison', link: '/guide/comparison' },
          { text: 'Migration', link: '/guide/migration' },
          { text: 'Security policy', link: '/security' },
          { text: 'Changelog', link: '/changelog' },
        ],
      },
    ],
    outline: { level: [2, 3] },
    search: { provider: 'local' },
    socialLinks: [
      { icon: 'github', link: repo },
      { icon: 'npm', link: 'https://www.npmjs.com/package/@mshindi-labs/refetch' },
    ],
    editLink: { pattern: `${repo}/edit/main/docs/:path`, text: 'Edit this page on GitHub' },
    footer: { message: 'Released under the MIT License.' },
  },
});
