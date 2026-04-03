import type { CSSProperties } from "react";
import type { HeadersFunction } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { EmbeddedNavLink } from "../embedded-nav-link";

const pageShellStyle: CSSProperties = {
  backgroundColor: "#f1f2f4",
  minHeight: "100%",
};

export default function ImageGeneratorPage() {
  return (
    <div style={pageShellStyle}>
      <s-page heading="AI Image Generator">
        <s-section>
          <s-text tone="subdued">
            Generate product images with preview-first or automatic update from each product
            page.
          </s-text>
        </s-section>

        <s-section>
          <EmbeddedNavLink hrefPathname="/app/products">
            Open products and generate images
          </EmbeddedNavLink>
        </s-section>
      </s-page>
    </div>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
