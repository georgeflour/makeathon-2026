import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },
  devIndicators: false,
  allowedDevOrigins: ["172.20.10.9"],
} as any;

export default nextConfig;
