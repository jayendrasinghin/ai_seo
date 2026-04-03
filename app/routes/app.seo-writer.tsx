import type { CSSProperties } from "react";
import type { HeadersFunction } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { EmbeddedNavLink } from "../embedded-nav-link";

const pageShellStyle: CSSProperties = {
  backgroundColor: "#f1f2f4",
  minHeight: "100%",
};

export default function SeoWriterPage() {
  return (
    <div style={pageShellStyle}>
      <s-page heading="AI SEO Writer">
        <s-section>
          <s-text tone="subdued">
            Use your existing product detail workflow to generate SEO title, SEO description,
            and product copy with AI.
          </s-text>
        </s-section>

        <s-section>
          <EmbeddedNavLink hrefPathname="/app/products">
            Open products and start writing SEO
          </EmbeddedNavLink>
        </s-section>
      </s-page>
    </div>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
