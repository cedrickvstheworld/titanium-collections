import type { NextConfig } from "next";

// GitHub Pages build (see .github/workflows/deploy.yml): GITHUB_PAGES=true and
// NEXT_PUBLIC_BASE_PATH=/titanium-collections. Pages only serves static files,
// so that build is a static export under the repo sub-path. Local dev/builds
// are unchanged.
const pages = process.env.GITHUB_PAGES === "true";
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const nextConfig: NextConfig = {
  ...(pages
    ? {
        output: "export", // static site in out/
        basePath,
        images: { unoptimized: true }, // no image optimizer on a static host
      }
    : {
        // not supported together with a static export
        cacheComponents: true,
        partialPrefetching: true,
      }),
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
