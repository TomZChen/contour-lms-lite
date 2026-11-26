import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  // Dev only: extra hosts allowed to load dev resources (HMR etc.), e.g. a
  // LAN/Tailscale IP when browsing from another device. Comma-separated.
  allowedDevOrigins: process.env.ALLOWED_DEV_ORIGINS?.split(",").map((s) => s.trim()).filter(Boolean),
};

export default nextConfig;
