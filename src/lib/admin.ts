import { notFound } from "next/navigation";
import { requireUser, type CurrentUser } from "./auth";

// CMS access is granted by email: ADMIN_EMAILS="a@x.com,b@y.com". The email must
// also be verified, otherwise anyone could sign up with an admin address.
export function isAdmin(user: Pick<CurrentUser, "email" | "emailVerified"> | null): boolean {
  if (!user?.emailVerified) return false;
  const list = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(user.email.toLowerCase());
}

// Non-admins get a 404 so the console's existence isn't revealed.
export async function requireAdmin(): Promise<CurrentUser> {
  const user = await requireUser();
  if (!isAdmin(user)) notFound();
  return user;
}
