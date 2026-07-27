import type { LoaderFunctionArgs } from "react-router";
import { Navigate, Outlet, useLoaderData, useLocation } from "react-router";
import { authenticate } from "../shopify.server";
import { PaySyncHomeButton } from "../HomeButton";
import { withEmbeddedSearch } from "../embedded-nav";
import {
  paypalConnectionRepository,
  settingsRepository,
  shopRepository,
} from "../repositories";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await shopRepository.upsertByDomain(session.shop);
  const settings = await shopRepository.getOrCreateSettings(shop.id);
  const connection = await paypalConnectionRepository.findByShopId(shop.id);

  let onboardingDone = Boolean(settings.onboardingCompletedAt);
  const paypalConnected = Boolean(connection);

  // Existing installs that already connected PayPal skip the new onboarding gate.
  if (!onboardingDone && paypalConnected) {
    await settingsRepository.completeOnboarding(shop.id);
    onboardingDone = true;
  }

  // Do not throw redirect() here — parent redirects during SPA/single-fetch
  // cause "No result found for routeId routes/app.paysync._index".
  // Navigate in the component instead so child loaders still resolve.
  return {
    onboardingDone,
    paypalConnected,
  };
};

export default function PaySyncLayout() {
  const { onboardingDone, paypalConnected } = useLoaderData<typeof loader>();
  const { pathname, search } = useLocation();
  const onOnboarding = pathname.startsWith("/app/paysync/onboarding");
  const onPaypal = pathname.startsWith("/app/paysync/paypal");

  if (!onboardingDone && !onOnboarding) {
    return (
      <Navigate
        to={withEmbeddedSearch("/app/paysync/onboarding", search)}
        replace
      />
    );
  }

  if (onboardingDone && !paypalConnected && !onOnboarding && !onPaypal) {
    return (
      <Navigate
        to={withEmbeddedSearch("/app/paysync/paypal", search)}
        replace
      />
    );
  }

  return (
    <>
      <PaySyncHomeButton />
      {!onOnboarding && onboardingDone && !paypalConnected && (
        <s-banner tone="warning">
          <s-paragraph>
            Connect PayPal under <strong>Payment accounts</strong> to sync
            tracking.
          </s-paragraph>
        </s-banner>
      )}
      <Outlet />
    </>
  );
}
