import { redirect } from "next/navigation";

import { ProfileForm } from "@/components/app/ProfileForm";
import { getSession } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Profile",
};

export default async function ProfilePage({
  searchParams,
}: {
  searchParams?: Promise<{ setup?: string }>;
}) {
  const session = await getSession();
  if (session.state !== "signed-in") {
    redirect("/sign-in");
  }
  const resolvedParams = searchParams ? await searchParams : undefined;
  const needsSetup = resolvedParams?.setup === "1" || !session.user.profileComplete;

  return (
    <section className="profile" aria-labelledby="profile-title">
      <div>
        <p className="eyebrow">Profile</p>
        <h1 id="profile-title" className="profile__title">
          {needsSetup ? "Set up your profile" : "Your profile"}
        </h1>
      </div>
      {needsSetup ? (
        <p className="banner" role="status">
          Choose a username to finish setting up your profile.
        </p>
      ) : null}
      <ProfileForm user={session.user} isSetup={needsSetup} />
    </section>
  );
}
