import { proxyAdmin } from "@/lib/admin-proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function handle(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  return proxyAdmin(request, path, {
    apiOrigin: process.env.ADMIN_API_URL || process.env.NEXT_PUBLIC_API_URL || "",
    appOrigin: process.env.ADMIN_APP_ORIGIN || process.env.NEXT_PUBLIC_SITE_URL || process.env.URL || "http://localhost:3000",
    production: process.env.NODE_ENV === "production",
  });
}

export { handle as GET, handle as HEAD, handle as POST, handle as PUT, handle as DELETE };
