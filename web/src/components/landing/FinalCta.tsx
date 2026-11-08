import { ButtonLink } from "@/components/ui/ButtonLink";

export function FinalCta() {
  return (
    <section className="section" aria-labelledby="closing-title">
      <div className="section__inner">
        <div className="closing glass">
          <h2 className="closing__title" id="closing-title">
            Simple, private, and built for real connection.
          </h2>
          <p className="muted">
            Sign in with a passwordless code to set up your profile, find people, and explore the workspace.
          </p>
          <div className="closing__actions">
            <ButtonLink href="/sign-in">Sign in with email</ButtonLink>
            <ButtonLink href="/status" variant="ghost">
              Check system status
            </ButtonLink>
          </div>
        </div>
      </div>
    </section>
  );
}
