import type { LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { PaySyncHomeButton } from "../HomeButton";
import { embeddedRedirect } from "../embedded-nav";
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

  const url = new URL(request.url);
  const onOnboarding = url.pathname.startsWith("/app/paysync/onboarding");
  let onboardingDone = Boolean(settings.onboardingCompletedAt);
  const paypalConnected = Boolean(connection);

  // Existing installs that already connected PayPal skip the new onboarding gate.
  if (!onboardingDone && paypalConnected) {
    await settingsRepository.completeOnboarding(shop.id);
    onboardingDone = true;
  }

  // New stores must connect PayPal via onboarding before using PaySync.
  // Keep ?shop=&host= or Shopify shows the login screen.
  if (!onboardingDone && !onOnboarding) {
    throw embeddedRedirect("/app/paysync/onboarding", request);
  }

  // After setup, reconnecting happens on the PayPal page (avoid redirect loops).
  if (
    onboardingDone &&
    !paypalConnected &&
    !onOnboarding &&
    !url.pathname.startsWith("/app/paysync/paypal")
  ) {
    throw embeddedRedirect("/app/paysync/paypal", request);
  }

  return {
    onboardingDone,
    paypalConnected,
    onOnboarding,
  };
};

export default function PaySyncLayout() {
  const { onboardingDone, paypalConnected, onOnboarding } =
    useLoaderData<typeof loader>();

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
