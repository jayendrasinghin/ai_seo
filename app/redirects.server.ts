type AdminGraphql = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

export type UrlRedirectRow = {
  id: string;
  path: string;
  target: string;
};

export async function listUrlRedirects(
  admin: AdminGraphql,
  first = 50,
  query?: string,
): Promise<{ redirects: UrlRedirectRow[]; error?: string }> {
  const response = await admin.graphql(
    `#graphql
      query SeoUrlRedirects($first: Int!, $query: String) {
        urlRedirects(first: $first, query: $query) {
          nodes {
            id
            path
            target
          }
        }
      }`,
    { variables: { first, query: query || null } },
  );

  const json = (await response.json()) as {
    data?: { urlRedirects?: { nodes?: UrlRedirectRow[] } };
    errors?: { message?: string }[];
  };

  if (json.errors?.length) {
    return {
      redirects: [],
      error: json.errors[0]?.message || "Failed to load redirects.",
    };
  }

  return { redirects: json.data?.urlRedirects?.nodes ?? [] };
}

export async function createUrlRedirect(
  admin: AdminGraphql,
  path: string,
  target: string,
): Promise<{ redirect?: UrlRedirectRow; error?: string }> {
  const response = await admin.graphql(
    `#graphql
      mutation SeoUrlRedirectCreate($urlRedirect: UrlRedirectInput!) {
        urlRedirectCreate(urlRedirect: $urlRedirect) {
          urlRedirect {
            id
            path
            target
          }
          userErrors {
            field
            message
          }
        }
      }`,
    {
      variables: {
        urlRedirect: {
          path: path.startsWith("/") ? path : `/${path}`,
          target,
        },
      },
    },
  );

  const json = (await response.json()) as {
    data?: {
      urlRedirectCreate?: {
        urlRedirect?: UrlRedirectRow | null;
        userErrors?: { field?: string[]; message?: string }[];
      };
    };
    errors?: { message?: string }[];
  };

  if (json.errors?.length) {
    return { error: json.errors[0]?.message || "Redirect create failed." };
  }

  const userErrors = json.data?.urlRedirectCreate?.userErrors ?? [];
  if (userErrors.length > 0) {
    return { error: userErrors.map((e) => e.message).filter(Boolean).join(" ") };
  }

  const redirect = json.data?.urlRedirectCreate?.urlRedirect;
  if (!redirect) return { error: "Redirect was not created." };
  return { redirect };
}

export async function deleteUrlRedirect(
  admin: AdminGraphql,
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  const response = await admin.graphql(
    `#graphql
      mutation SeoUrlRedirectDelete($id: ID!) {
        urlRedirectDelete(id: $id) {
          deletedUrlRedirectId
          userErrors {
            field
            message
          }
        }
      }`,
    { variables: { id } },
  );

  const json = (await response.json()) as {
    data?: {
      urlRedirectDelete?: {
        deletedUrlRedirectId?: string | null;
        userErrors?: { message?: string }[];
      };
    };
    errors?: { message?: string }[];
  };

  if (json.errors?.length) {
    return { ok: false, error: json.errors[0]?.message || "Delete failed." };
  }

  const userErrors = json.data?.urlRedirectDelete?.userErrors ?? [];
  if (userErrors.length > 0) {
    return {
      ok: false,
      error: userErrors.map((e) => e.message).filter(Boolean).join(" "),
    };
  }

  return { ok: Boolean(json.data?.urlRedirectDelete?.deletedUrlRedirectId) };
}
