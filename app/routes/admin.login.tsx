import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  Form,
  data,
  isRouteErrorResponse,
  redirect,
  useActionData,
  useLoaderData,
  useRouteError,
} from "react-router";
import {
  adminOtpEnabled,
  adminOtpPendingCookie,
  adminPanelEnabled,
  adminSessionCookie,
  authenticateAdminPassword,
  createAdminSession,
  verifyAdminOtp,
} from "../admin-auth.server";
import { mailConfigured } from "../mail.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (!adminPanelEnabled()) throw new Response("Not found", { status: 404 });
  const cookieHeader = request.headers.get("Cookie");
  let token: string | null = null;
  try {
    const parsed = await adminSessionCookie.parse(cookieHeader);
    token = typeof parsed === "string" ? parsed : null;
  } catch {
    token = null;
  }
  if (token) throw redirect("/admin");
  return {
    otpEnabled: adminOtpEnabled(),
    emailReady: mailConfigured(),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  if (!adminPanelEnabled()) throw new Response("Not found", { status: 404 });
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "password");

  if (intent === "verify_otp") {
    const cookieHeader = request.headers.get("Cookie");
    const challengeId = await adminOtpPendingCookie.parse(cookieHeader);
    if (!challengeId || typeof challengeId !== "string") {
      return { step: "password" as const, error: "Session expired. Sign in again." };
    }
    const code = String(formData.get("otp") || "");
    const result = await verifyAdminOtp(challengeId, code);
    if (!result.ok) return { step: "otp" as const, error: result.message };

    const { token } = await createAdminSession(result.adminUserId);
    const headers = new Headers();
    headers.append("Set-Cookie", await adminSessionCookie.serialize(token));
    headers.append(
      "Set-Cookie",
      await adminOtpPendingCookie.serialize("", { maxAge: 0 }),
    );
    return redirect("/admin", { headers });
  }

  if (intent === "restart") {
    return redirect("/admin/login", {
      headers: {
        "Set-Cookie": await adminOtpPendingCookie.serialize("", { maxAge: 0 }),
      },
    });
  }

  const email = String(formData.get("email") || "");
  const password = String(formData.get("password") || "");
  const result = await authenticateAdminPassword(email, password);
  if (!result.ok) return { step: "password" as const, error: result.message };

  if (!result.needsOtp) {
    const { token } = await createAdminSession(result.adminUserId);
    return redirect("/admin", {
      headers: {
        "Set-Cookie": await adminSessionCookie.serialize(token),
      },
    });
  }

  return data(
    {
      step: "otp" as const,
      emailMasked: result.emailMasked,
      delivery: result.delivery,
    },
    {
      headers: {
        "Set-Cookie": await adminOtpPendingCookie.serialize(result.challengeId),
      },
    },
  );
};

const styles = `
  :root {
    --bg0: #0b1220;
    --bg1: #111827;
    --card: #ffffff;
    --ink: #0f172a;
    --muted: #64748b;
    --line: #e2e8f0;
    --accent: #0d9488;
    --accent-ink: #0f766e;
    --danger: #b91c1c;
  }
  * { box-sizing: border-box; }
  body { margin: 0; }
  .login-shell {
    min-height: 100vh;
    display: grid;
    place-items: center;
    padding: 1.5rem;
    background:
      radial-gradient(900px 420px at 10% -10%, rgba(13,148,136,.35), transparent 55%),
      radial-gradient(700px 380px at 100% 0%, rgba(59,130,246,.22), transparent 50%),
      linear-gradient(160deg, var(--bg0), var(--bg1));
    font-family: "Segoe UI", ui-sans-serif, system-ui, -apple-system, sans-serif;
    color: var(--ink);
  }
  .login-card {
    width: 100%;
    max-width: 420px;
    background: var(--card);
    border-radius: 18px;
    padding: 1.75rem 1.5rem 1.5rem;
    box-shadow: 0 24px 60px rgba(0,0,0,.35);
  }
  .brand {
    font-size: .75rem;
    letter-spacing: .14em;
    text-transform: uppercase;
    color: var(--accent-ink);
    font-weight: 700;
    margin: 0 0 .35rem;
  }
  h1 { margin: 0 0 .35rem; font-size: 1.55rem; letter-spacing: -.02em; }
  .sub { margin: 0 0 1.25rem; color: var(--muted); font-size: .95rem; line-height: 1.45; }
  label { display: block; font-size: .8rem; font-weight: 600; color: #334155; margin: 0 0 .35rem; }
  input {
    width: 100%;
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: .7rem .85rem;
    font-size: 1rem;
    margin-bottom: .85rem;
    outline: none;
    background: #f8fafc;
  }
  input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(13,148,136,.18); background: #fff; }
  .btn {
    width: 100%;
    border: 0;
    border-radius: 10px;
    padding: .75rem 1rem;
    font-size: 1rem;
    font-weight: 650;
    cursor: pointer;
    background: linear-gradient(135deg, #0d9488, #0f766e);
    color: #fff;
  }
  .btn:hover { filter: brightness(1.05); }
  .btn-ghost {
    width: 100%;
    margin-top: .65rem;
    border: 0;
    background: transparent;
    color: var(--muted);
    font-size: .9rem;
    cursor: pointer;
    text-decoration: underline;
  }
  .error {
    margin: .75rem 0 0;
    padding: .65rem .75rem;
    border-radius: 8px;
    background: #fef2f2;
    color: var(--danger);
    font-size: .9rem;
  }
  .hint {
    margin: .85rem 0 0;
    font-size: .8rem;
    color: var(--muted);
  }
  .otp-input { letter-spacing: .35em; font-weight: 700; text-align: center; font-size: 1.25rem; }
`;

export default function AdminLoginPage() {
  const { otpEnabled, emailReady } = useLoaderData<typeof loader>();
  const data = useActionData<
    | { step: "password"; error?: string }
    | { step: "otp"; error?: string; emailMasked?: string; delivery?: string }
    | undefined
  >();

  // When action returns Response JSON for OTP step, React Router parses it into useActionData.
  const step = data && "step" in data ? data.step : "password";
  const error = data && "error" in data ? data.error : undefined;
  const emailMasked =
    data && "emailMasked" in data ? data.emailMasked : undefined;
  const delivery = data && "delivery" in data ? data.delivery : undefined;
  const viaConsole = delivery === "console";

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: styles }} />
      <div className="login-shell">
        <div className="login-card">
          <p className="brand">SEOI Support</p>
          <h1>{step === "otp" ? "Enter login code" : "Admin login"}</h1>
          <p className="sub">
            {step === "otp"
              ? viaConsole
                ? `Password OK. OTP is printed in the app server terminal (email not configured yet). Enter the 6-digit code for ${emailMasked ?? "your account"}.`
                : `We emailed a 6-digit code to ${emailMasked ?? "your email"}.`
              : "Sign in with email and password to open the support tickets dashboard."}
          </p>

          {step === "otp" ? (
            <Form method="post">
              <input type="hidden" name="intent" value="verify_otp" />
              <label htmlFor="otp">One-time code</label>
              <input
                id="otp"
                className="otp-input"
                name="otp"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="••••••"
                maxLength={6}
                required
              />
              <button className="btn" type="submit">
                Verify & continue
              </button>
              {error ? <p className="error">{error}</p> : null}
              <p className="hint">
                {viaConsole
                  ? "Look for [mail:console] in the terminal running npm run dev. Code expires in 10 minutes."
                  : "Check inbox (and spam). Code expires in 10 minutes."}
              </p>
            </Form>
          ) : null}

          {step === "otp" ? (
            <Form method="post">
              <input type="hidden" name="intent" value="restart" />
              <button className="btn-ghost" type="submit">
                Use a different account
              </button>
            </Form>
          ) : null}

          {step === "password" ? (
            <Form method="post">
              <input type="hidden" name="intent" value="password" />
              <label htmlFor="email">Email</label>
              <input
                id="email"
                name="email"
                type="email"
                placeholder="you@company.com"
                required
                autoComplete="username"
              />
              <label htmlFor="password">Password</label>
              <input
                id="password"
                name="password"
                type="password"
                placeholder="••••••••"
                required
                autoComplete="current-password"
              />
              <button className="btn" type="submit">
                Continue
              </button>
              {error ? <p className="error">{error}</p> : null}
              <p className="hint">
                {otpEnabled
                  ? emailReady
                    ? "After password check, a one-time code is sent to your admin email."
                    : "OTP is on. Add RESEND_API_KEY + MAIL_FROM in .env to receive codes by email; until then the code appears in the server terminal."
                  : "OTP is disabled (ADMIN_OTP_ENABLED=false). Password-only login."}
              </p>
            </Form>
          ) : null}
        </div>
      </div>
    </>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  const isDisabled404 =
    isRouteErrorResponse(error) &&
    error.status === 404 &&
    error.data === "Not found";

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: styles }} />
      <div className="login-shell">
        <div className="login-card">
          <h1>{isDisabled404 ? "Admin panel is disabled" : "Unable to open admin login"}</h1>
          <p className="sub">
            {isDisabled404
              ? "Set ADMIN_PANEL_ENABLED=true in your environment, restart the app, then open /admin/login again."
              : "Please try again. If this keeps happening, check server logs for the exact error."}
          </p>
        </div>
      </div>
    </>
  );
}
