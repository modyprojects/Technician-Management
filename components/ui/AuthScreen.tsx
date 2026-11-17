import Link from "next/link";
import type { ReactNode, Ref } from "react";
import { BrandLogo } from "./BrandLogo";

// The page of the password-reset screens (D65): the sign-in screen's own layout and classes
// (LoginScreen, AU-01 as approved on 2026-11-17): the dark page, the logo and the subtitle at the
// top, and the white card centred in the viewport with its heading centred. No hooks: usable from
// Server Components. The caller passes the card's content under the heading. A client caller that
// replaces the card's content (an answer after a request) passes `titleRef`: the heading can then
// take focus (tabIndex -1, no focus ring, styles/ui.css), so a screen reader announces the new view.

const TITLE_ID = "auth-title";

export function AuthScreen({ title, titleRef, children }: { title: string; titleRef?: Ref<HTMLHeadingElement>; children: ReactNode }) {
  return (
    <main className="login">
      <div className="login-col">
        <div className="login-brand">
          <BrandLogo className="brand-logo-login" />
          <div className="login-product">ניהול טכנאים</div>
        </div>
        <section className="card login-card" aria-labelledby={TITLE_ID}>
          <h1 id={TITLE_ID} {...(titleRef ? { ref: titleRef, tabIndex: -1 } : {})}>
            {title}
          </h1>
          {children}
        </section>
      </div>
    </main>
  );
}

/** A centred text link inside the card ("חזרה לכניסה", "בקשת קישור חדש"). */
export function AuthCardLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <p className="login-p login-p-center">
      <Link className="lnk login-link" href={href}>
        {children}
      </Link>
    </p>
  );
}
