import { NextResponse } from "next/server";
import { getDbUser } from "@/lib/getDbUser";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const user = await getDbUser();
  if (!user) return NextResponse.json({ connected: false }, { status: 401 });
  const token = await prisma.googleOAuthToken.findUnique({ where: { userId: user.id }, select: { id: true } });
  return NextResponse.json({ connected: Boolean(token) });
}