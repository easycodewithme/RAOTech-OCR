import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  async redirects() {
    return [
      {
        source: "/demo",
        destination: "/book-your-demo",
        permanent: true,
      },
      {
        source: "/demo/:path*",
        destination: "/book-your-demo/:path*",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
