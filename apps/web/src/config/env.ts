import { z } from "zod";

const schema = z.object({
  NEXT_PUBLIC_API_URL: z.url().refine((value) => URL.canParse(value) && ["http:", "https:"].includes(new URL(value).protocol), "Use an HTTP(S) URL"),
});

const result = schema.safeParse({ NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL });
if (!result.success) {
  throw new Error("Invalid web environment: NEXT_PUBLIC_API_URL must be an HTTP(S) URL");
}

export const env = result.data;
