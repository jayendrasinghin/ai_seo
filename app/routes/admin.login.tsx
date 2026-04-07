import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  Form,
  isRouteErrorResponse,
  redirect,
  useActionData,
  useRouteError,
} from "react-router";
import {
  adminPanelEnabled,
  adminSessionCookie,
  authenticateAdminLogin,
  createAdminSession,
} from "../admin-auth.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (!adminPanelEnabled()) throw new Response("Not found", { status: 404 });
  const cookieHeader = request.headers.get("Cookie");
  const token = await adminSessionCookie.parse(cookieHeader);
  if (token) throw redirect("/admin");
  return null;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  if (!adminPanelEnabled()) throw new Response("Not found", { status: 404 });
  const formData = await request.formData();
  const email = String(formData.get("email") || "");
  const password = String(formData.get("password") || "");
  const result = await authenticateAdminLogin(email, password);
  if (!result.ok) return { error: result.message };

  const { token } = await createAdminSession(result.adminUserId);
  return redirect("/admin", {
    headers: {
      "Set-Cookie": await adminSessionCookie.serialize(token),
    },
  });
};

export default function AdminLoginPage() {
  const data = useActionData<typeof action>();
  return (
    <div style={{ maxWidth: 420, margin: "4rem auto", padding: "1rem" }}>
      <h1 style={{ marginBottom: "0.5rem" }}>Admin login</h1>
      <p style={{ marginTop: 0, color: "#555" }}>
        Sign in to access support tickets dashboard.
      </p>
      <Form method="post">
        <div style={{ display: "grid", gap: "0.75rem" }}>
          <input name="email" type="email" placeholder="Email" required />
          <input name="password" type="password" placeholder="Password" required />
          <button type="submit">Sign in</button>
          {data && "error" in data && data.error ? (
            <p style={{ color: "#b91c1c", margin: 0 }}>{data.error}</p>
          ) : null}
        </div>
      </Form>
    </div>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  const isDisabled404 =
    isRouteErrorResponse(error) &&
    error.status === 404 &&
    error.data === "Not found";

  return (
    <div style={{ maxWidth: 560, margin: "4rem auto", padding: "1rem" }}>
      <h1 style={{ marginBottom: "0.5rem" }}>
        {isDisabled404 ? "Admin panel is disabled" : "Unable to open admin login"}
      </h1>
      <p style={{ marginTop: 0, color: "#555" }}>
        {isDisabled404
          ? "Set ADMIN_PANEL_ENABLED=true in your environment, restart the app, then open /admin/login again."
          : "Please try again. If this keeps happening, check server logs for the exact error."}
      </p>
    </div>
  );
}
