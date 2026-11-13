// Serve i loghi delle squadre caricati dall'area staff: /api/logo/<id>
// L'URL contiene ?v=... che cambia a ogni nuovo caricamento, quindi la cache può essere lunghissima.

import { getStore } from "@netlify/blobs";

export default async (req, context) => {
  const id = context.params?.id || "";
  if (!/^[0-9a-f]{16}$/.test(id)) return new Response("Not found", { status: 404 });
  const res = await getStore("luzzogno-loghi").getWithMetadata(id, { type: "arrayBuffer" });
  if (!res) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  const type = ["image/png", "image/jpeg", "image/webp"].includes(res.metadata?.type) ? res.metadata.type : "application/octet-stream";
  return new Response(res.data, {
    headers: {
      "Content-Type": type,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "public, max-age=31536000, immutable",
      "Netlify-CDN-Cache-Control": "public, durable, max-age=31536000, immutable",
    },
  });
};

export const config = { path: "/api/logo/:id" };
