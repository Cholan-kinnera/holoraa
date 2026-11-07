type Status = "commitment" | "in-build" | "practice";

const PRINCIPLES: ReadonlyArray<{ title: string; body: string; status: Status }> = [
  {
    title: "Simple by default",
    body: "One space with few controls. A feature has to earn its place.",
    status: "practice",
  },
  {
    title: "Safe by design",
    body: "Protected routes fail closed. Sign-in uses one-time codes and server-side sessions.",
    status: "in-build",
  },
  {
    title: "Private by default",
    body: "Your conversations are for you and the people you choose. Data is never sold.",
    status: "commitment",
  },
  {
    title: "Respectful of attention",
    body: "No algorithmic feed ranking, no tracking pixels, and no features that exist only to keep you here.",
    status: "commitment",
  },
  {
    title: "Built in the open",
    body: "Decisions and quality gates are recorded in the repository alongside the code.",
    status: "practice",
  },
];

const STATUS_LABEL: Record<Status, { text: string; className: string }> = {
  commitment: { text: "Commitment", className: "tag" },
  "in-build": { text: "In build", className: "tag tag--progress" },
  practice: { text: "How we work", className: "tag" },
};

export function Principles() {
  return (
    <section className="section" id="principles" aria-labelledby="principles-title">
      <div className="section__inner">
        <div className="section__head">
          <p className="eyebrow">Principles</p>
          <h2 className="section__title" id="principles-title">
            Five rules we build against.
          </h2>
          <p className="lede-text">
            Each card says whether it is a commitment we hold ourselves to, something in build, or how the work is done.
          </p>
        </div>
        <ul className="principles">
          {PRINCIPLES.map((principle) => {
            const label = STATUS_LABEL[principle.status];
            return (
              <li key={principle.title} className="principle glass">
                <span className={label.className}>{label.text}</span>
                <h3>{principle.title}</h3>
                <p>{principle.body}</p>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
