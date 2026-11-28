import path from "node:path";
import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Dev only: let phones on the same Wi-Fi (http://192.168.x.x:3000) load the dev server.
  allowedDevOrigins: ["192.168.*.*"],
  outputFileTracingRoot: path.join(__dirname),
  // The receipt image reads its Khmer font from disk: ship it with that route.
  outputFileTracingIncludes: { "/receipt/[reference]": ["./src/assets/fonts/**"] },
  experimental: {
    // Server Action body limit (kept from the screenshot upload; payments now use PayWay KHQR).
    serverActions: { bodySizeLimit: "6mb" },
  },
  turbopack: {
    // Standalone app in DormPay/user; never resolve files from the parent folder.
    root: path.join(__dirname),
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
