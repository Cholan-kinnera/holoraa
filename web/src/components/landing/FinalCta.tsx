import { ButtonLink } from "@/components/ui/ButtonLink";

export function FinalCta() {
  return (
    <section className="section" aria-labelledby="closing-title">
      <div className="section__inner">
        <div className="closing glass">
          <h2 className="closing__title" id="closing-title">
            Simple, private, and still being built.
          </h2>
          <p className="muted">Sign-in is not open yet. You can follow what runs today on the status page.</p>
          <div className="closing__actions">
            <ButtonLink href="/status">Check system status</ButtonLink>
            <ButtonLink href="#principles" variant="ghost">
              Read the principles
            </ButtonLink>
          </div>
        </div>
      </div>
    </section>
  );
}
