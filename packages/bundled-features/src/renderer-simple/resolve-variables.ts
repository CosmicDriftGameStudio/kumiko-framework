import type { RendererContext, RenderRequest } from "../renderer-foundation";
import { createTemplateResolverApi, TemplateNotFoundError } from "../template-resolver/api";
import { FALLBACK_LOCALE } from "../template-resolver/constants";

type NotificationRequest = Extract<RenderRequest, { kind: "notification" }>;

/** Merge template-resolver content (plain JSON EmailTemplateData) with runtime variables. */
export async function resolveNotificationVariables(
  req: NotificationRequest,
  ctx: RendererContext,
): Promise<Readonly<Record<string, unknown>>> {
  const variables = req.payload.variables ?? {};
  const slug = req.payload.template?.trim();
  if (!slug || req.payload.content || !ctx.db) {
    return variables;
  }

  try {
    const api = createTemplateResolverApi(ctx.db);
    const locale = req.payload.locale ?? FALLBACK_LOCALE;
    const resolved = await api.resolveTemplate({
      tenantId: ctx.tenantId,
      slug,
      kind: "notification",
      locale,
    });
    if (resolved.contentFormat === "plain") {
      const base = parsePlainTemplateContent(resolved.content);
      return { ...base, ...variables };
    }
    return { ...variables, body: resolved.content };
  } catch (err) {
    if (err instanceof TemplateNotFoundError) {
      return variables;
    }
    throw err;
  }
}

function parsePlainTemplateContent(content: string): Record<string, unknown> {
  const trimmed = content.trim();
  if (!trimmed) return {};
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // ponytail: non-JSON plain content becomes a single body section downstream
  }
  return { body: content };
}
