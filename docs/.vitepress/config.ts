import { defineConfig } from 'vitepress';

const repo = 'https://github.com/baraka-mshindi/refetch';

// The site is deliberately thin: the README, SECURITY.md and CHANGELOG.md stay the single
// source of truth and are included into pages, so the docs cannot drift from them.
export default defineConfig({
  title: 'refetch',
  description:
    'A production-grade HTTP client on native fetch: result objects, typed errors, retry, schema validation, streaming.',
  // Served as a GitHub Pages project site.
  base: '/refetch/',
  cleanUrls: true,
  lastUpdated: true,
  // The included README links to SECURITY.md by its repository path.
  ignoreDeadLinks: [/SECURITY/],
  themeConfig: {
    nav: [
      { text: 'Guide', link: '/guide' },
      { text: 'Comparison', link: '/guide#why-refetch' },
      { text: 'Security', link: '/security' },
      { text: 'Changelog', link: '/changelog' },
    ],
    outline: { level: [2, 3] },
    search: { provider: 'local' },
    socialLinks: [
      { icon: 'github', link: repo },
      { icon: 'npm', link: 'https://www.npmjs.com/package/@mshindi-labs/refetch' },
    ],
    editLink: { pattern: `${repo}/edit/main/README.md`, text: 'Edit the README on GitHub' },
    footer: { message: 'Released under the MIT License.' },
  },
});
