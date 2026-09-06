import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdf-parse loads a Node worker and its native canvas dependency at runtime.
  // Keeping both external preserves that worker in Vercel serverless functions.
  serverExternalPackages: ["pdf-parse", "@napi-rs/canvas"],
};

export default nextConfig;
