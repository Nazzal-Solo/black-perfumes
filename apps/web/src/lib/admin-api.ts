export type AdminSession = { admin: { id: number; email: string }; expiresAt: string };
export type Category = { id: string; name: string; _count: { products: number } };
export type Product = {
  id: string; name: string; description: string; priceJod: string | null; categoryId: string;
  isVisible: boolean; category: { id: string; name: string }; _count: { images: number };
  inspirationBrand: string | null; inspirationFragrance: string | null;
  productType: "UNCONFIRMED" | "INSPIRED" | "ORIGINAL" | "OTHER";
  customDisplayName: string | null; nameAr: string | null; descriptionAr: string | null;
  disclosureText: string | null; disclosureAr: string | null;
  availability: "AVAILABLE" | "UNAVAILABLE" | null; sizeMl: string | null; concentration: string | null;
  fragranceNotes: string | null; fragranceNotesAr: string | null;
  referenceVerified: boolean; isArchived: boolean; catalogReferences: string[]; seasonalRecommendations: string[]; reviewNotes: string | null;
  images: ProductImage[];
};
export type ProductImage = { cloudinaryPublicId?: string; id: string; url: string; altText: string; position: number };
export type ProductList = { products: Product[]; total: number; page: number; pageSize: number };

export class ApiError extends Error {
  constructor(public status: number, message: string, public fields: Record<string, string[]> = {}, public stage?: "upload" | "attachment") { super(message); }
}

export const adminApiUrl = (path: string) => `/api/admin${path}`;

export async function adminApi<T>(path: string, options: { method?: "POST" | "PUT" | "DELETE"; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(adminApiUrl(path), {
      method: options.method ?? "GET", credentials: "include", cache: "no-store", signal: options.signal,
      ...(options.method ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(options.body ?? {}) } : {}),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    throw new ApiError(0, "Unable to reach the server. Check your connection and try again.");
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string; fields?: Record<string, string[]>; stage?: "upload" | "attachment" };
    throw new ApiError(response.status, body.error ?? "Something went wrong. Please try again.", body.fields, body.stage);
  }
  return response.status === 204 ? undefined as T : response.json() as Promise<T>;
}
