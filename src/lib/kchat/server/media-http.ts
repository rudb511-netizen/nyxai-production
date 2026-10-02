import { getSessionUser } from "@/lib/auth/verify.server";

export function bearerFromRequest(request: Request): string | undefined {
  const header = request.headers.get("authorization");
  if (header?.startsWith("Bearer ")) return header.slice(7).trim() || undefined;
  const q = new URL(request.url).searchParams.get("access");
  return q?.trim() || undefined;
}

export async function requireMediaUser(request: Request): Promise<string> {
  const user = await getSessionUser(bearerFromRequest(request));
  if (user?.id) return user.id;
  const { requireUserId } = await import("@/lib/auth/verify.server");
  return requireUserId(bearerFromRequest(request));
}

export function jsonError(message: string, status = 400): Response {
  return Response.json({ error: message }, { status });
}
