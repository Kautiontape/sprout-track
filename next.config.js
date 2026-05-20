// ktn fork: skip TypeScript and ESLint during `next build` to fit in our
// 2 GB-RAM build host. The default Next.js build peaks at ~1.5 GB and OOMs.
// Without these passes peak drops to ~600 MB.
//
// We don't lose the safety net — run them as separate steps:
//   npx tsc --noEmit       (typecheck — fail-fast, no build)
//   npm run lint           (ESLint)
//
// If upstream ever adds its own next.config.js, this file will conflict on
// rebase. Resolve by merging both configs.

/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
};

module.exports = nextConfig;
