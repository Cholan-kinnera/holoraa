import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AppShell } from "./AppShell";
import { ProfileForm } from "./ProfileForm";
import { SignInForm } from "@/app/sign-in/SignInForm";

const hostile = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "ada@example.com",
  username: "ada",
  displayName: '<img src=x onerror="alert(1)">',
  bio: "<script>alert('bio')</script>",
  avatarUrl: null,
  profileComplete: true,
};

describe("app render", () => {
  it("escapes a hostile display name in the shell", () => {
    const html = renderToStaticMarkup(<AppShell user={hostile}>{null}</AppShell>);
    expect(html).toContain("&lt;img src=x onerror=");
    expect(html).not.toContain('<img src=x onerror="alert(1)">');
  });

  it("escapes a hostile bio in the profile form", () => {
    const html = renderToStaticMarkup(<ProfileForm user={hostile} />);
    expect(html).toContain("&lt;script&gt;alert(&#x27;bio&#x27;)&lt;/script&gt;");
    expect(html).not.toContain("<script>alert('bio')</script>");
  });

  it("renders the shell with the empty conversation state and no invented contacts", () => {
    const html = renderToStaticMarkup(<AppShell user={hostile}>{null}</AppShell>);
    expect(html).toContain("No conversations yet.");
    expect(html).toContain("Messaging is in development");
  });

  it("renders the sign-in email step with an accessible field and no inline styles", () => {
    const html = renderToStaticMarkup(<SignInForm expired={false} />);
    expect(html).toContain('name="email"');
    expect(html).toContain("Send code");
    expect(html).not.toMatch(/\sstyle="/);
  });

  it("shows the expired-session notice when the flag is set", () => {
    const html = renderToStaticMarkup(<SignInForm expired />);
    expect(html).toContain("Your session has ended.");
  });

  it("renders no inline style attributes in the signed-in shell or profile", () => {
    expect(renderToStaticMarkup(<AppShell user={hostile}>{null}</AppShell>)).not.toMatch(/\sstyle="/);
    expect(renderToStaticMarkup(<ProfileForm user={hostile} />)).not.toMatch(/\sstyle="/);
  });
});
