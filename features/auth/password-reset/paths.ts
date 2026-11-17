// The password-reset routes and the link's lifetime (D65). Constants only, so client components can
// import them without the input schemas (and Zod).

export const FORGOT_PASSWORD_PATH = "/login/forgot";
export const RESET_PASSWORD_PATH = "/login/reset";
/** The sign-in screen's `?state=` value after a successful reset (a notice, never a session state). */
export const PASSWORD_UPDATED_STATE = "password-updated";
export const PASSWORD_UPDATED_PATH = `/login?state=${PASSWORD_UPDATED_STATE}`;

/** How long a reset link is valid, and how long after its use the reset session may set a password. */
export const RESET_LINK_MINUTES = 60;
