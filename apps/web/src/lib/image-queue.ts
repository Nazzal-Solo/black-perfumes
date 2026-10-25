import type { ProductImage } from "./admin-api";

export const MAX_PRODUCT_IMAGES = 10;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export type QueuedImage = {
  id: string; file?: File; preview?: string; image?: ProductImage;
  progress: number; status: "Waiting" | "Uploading" | "Processing" | "Saved" | "Failed" | "Save unconfirmed";
  grant?: { ticket: string; publicId: string; expiresAt: number };
  uncertain?: boolean; error?: string;
};
export function validateImageSelection(files: File[], count: number): string | null {
  if (count + files.length > MAX_PRODUCT_IMAGES) return "A product can have up to 10 images. Select fewer files or remove an existing image.";
  if (files.some(file => !["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size < 1 || file.size > MAX_IMAGE_BYTES)) return "Choose JPEG, PNG, or WebP images, each up to 10 MB.";
  return null;
}
export function reconcileImageQueue(items: QueuedImage[], images: ProductImage[]): QueuedImage[] {
  const result = items.flatMap(item => {
    const image = images.find(image => image.id === item.image?.id || (!!item.grant && image.cloudinaryPublicId === item.grant.publicId));
    if (image) return [{ ...item, image, file: undefined, preview: undefined, progress: 100, status: "Saved" as const, uncertain: false, error: undefined }];
    return item.image ? [] : [item];
  });
  for (const image of images) if (!result.some(item => item.image?.id === image.id)) result.push({ id: image.id, image, progress: 100, status: "Saved" });
  return result;
}
export function readUploadGrant(ticket: string) {
  const encoded = ticket.split(".")[0]!;
  const claim = JSON.parse(atob(encoded.replace(/-/g, "+").replace(/_/g, "/"))) as { publicId?: unknown; expiresAt?: unknown };
  if (typeof claim.publicId !== "string" || typeof claim.expiresAt !== "number") throw new Error("Unable to prepare image upload.");
  return { ticket, publicId: claim.publicId, expiresAt: claim.expiresAt };
}
export const UNCONFIRMED_UPLOAD = "This upload could not be confirmed and its ticket has expired. Refresh images and review before selecting this file again.";
export type QueueTransport = {
  list: () => Promise<ProductImage[]>;
  issue: (file: File) => Promise<string>;
  upload: (file: File, ticket: string, progress: (value: number) => void) => Promise<ProductImage[]>;
  reorder: (ids: string[]) => Promise<ProductImage[]>;
};
export async function uploadImageQueue({ getItems, setItems, transport, changed, ids, now = Date.now }: {
  getItems: () => QueuedImage[]; setItems: (items: QueuedImage[]) => void;
  transport: QueueTransport; changed: () => void; ids?: Set<string>; now?: () => number;
}) {
  const patch = (id: string, values: Partial<QueuedImage>) => setItems(getItems().map(item => item.id === id ? { ...item, ...values } : item));
  let images = await transport.list();
  const hadPending = getItems().filter(item => !item.image).length;
  setItems(reconcileImageQueue(getItems(), images));
  if (getItems().filter(item => !item.image).length < hadPending) changed();
  for (const selected of getItems()) {
    const item = getItems().find(item => item.id === selected.id);
    if (!item?.file || item.image || (ids && !ids.has(item.id))) continue;
    try {
      patch(item.id, { status: "Uploading", error: undefined, progress: 0 });
      let grant = item.grant;
      if (grant && grant.expiresAt <= now()) {
        if (item.uncertain) throw new Error(UNCONFIRMED_UPLOAD);
        grant = undefined;
      }
      if (!grant) grant = readUploadGrant(await transport.issue(item.file));
      patch(item.id, { grant });
      // Retain the exact ticket across ambiguous responses: the existing API deduplicates its public ID.
      patch(item.id, { uncertain: true });
      images = await transport.upload(item.file, grant.ticket, progress => patch(item.id, { progress, status: progress >= 100 ? "Processing" : "Uploading" }));
      if (!images.some(image => image.cloudinaryPublicId === grant.publicId)) throw new Error("Image attachment could not be confirmed. Refresh images before retrying.");
      setItems(reconcileImageQueue(getItems(), images));
      changed();
    } catch (error) {
      const details = error as { status?: number; stage?: string };
      const latest = getItems().find(value => value.id === item.id);
      const uncertain = !!latest?.uncertain && details.stage !== "upload";
      patch(item.id, { status: uncertain ? "Save unconfirmed" : "Failed", uncertain, error: error instanceof Error ? error.message : "Upload failed" });
      if (details.status === 401) throw error;
    }
  }
  const order = getItems().flatMap(item => item.image ? [item.image.id] : []);
  if (order.join(",") !== images.map(image => image.id).join(",")) {
    images = await transport.reorder(order);
    setItems(reconcileImageQueue(getItems(), images));
    changed();
  }
}
