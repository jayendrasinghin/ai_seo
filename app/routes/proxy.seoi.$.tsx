import type { LoaderFunctionArgs } from "react-router";
import { seoiProxyLoader } from "../seo-proxy.server";

export const loader = (args: LoaderFunctionArgs) => seoiProxyLoader(args);
