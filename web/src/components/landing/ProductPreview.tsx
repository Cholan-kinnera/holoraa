const RAIL = ["Friends", "Weekend plans", "Notes"] as const;

const THREAD: ReadonlyArray<{ text: string; own?: boolean }> = [
  { text: "Who's in for Saturday?" },
  { text: "I'm in. I'll bring the good bread.", own: true },
  { text: "Same. Let's keep it small this time." },
];

const NOTES: ReadonlyArray<{ title: string; body: string; tag: string }> = [
  {
    title: "Private by default",
    body: "Conversations and profiles are for the people you choose.",
    tag: "Design goal",
  },
  {
    title: "No feed to scroll",
    body: "There is no ranked timeline. You see what people send you.",
    tag: "Principle",
  },
  {
    title: "Quiet by design",
    body: "Nothing is built to pull you back. Notification settings belong to you.",
    tag: "Design goal",
  },
];

export function ProductPreview() {
  return (
    <section className="section" id="preview" aria-labelledby="preview-title">
      <div className="section__inner">
        <div className="section__head">
          <p className="eyebrow">Product preview</p>
          <h2 className="section__title" id="preview-title">
            A quiet thread, not a feed.
          </h2>
        </div>
        <div className="preview">
          <figure className="preview__frame glass">
            <div className="preview__window" role="img" aria-label="Illustrative sketch of a conversation view with three messages">
              <div className="preview__rail" aria-hidden="true">
                {RAIL.map((item, index) => (
                  <span
                    key={item}
                    className={index === 1 ? "preview__rail-item preview__rail-item--active" : "preview__rail-item"}
                  >
                    {item}
                  </span>
                ))}
              </div>
              <div className="preview__main" aria-hidden="true">
                <div className="preview__top">Weekend plans</div>
                <div className="preview__thread">
                  {THREAD.map((message) => (
                    <p key={message.text} className={message.own ? "bubble bubble--own" : "bubble"}>
                      {message.text}
                    </p>
                  ))}
                </div>
                <div className="preview__composer">Write a message</div>
              </div>
            </div>
            <figcaption className="preview__caption">
              Illustrative preview of a conversation view. It is not a screenshot of a released interface.
            </figcaption>
          </figure>
          <div className="preview__notes">
            {NOTES.map((note) => (
              <article key={note.title} className="note glass">
                <span className="tag">{note.tag}</span>
                <h3>{note.title}</h3>
                <p>{note.body}</p>
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
