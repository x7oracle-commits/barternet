import QRCode from "qrcode";

export async function generateQR(text, size = 256) {
  return QRCode.toDataURL(text, {
    width: size,
    margin: 2,
    color: { dark: "#e2e8f0", light: "#1a1d2e" },
    errorCorrectionLevel: "M",
  });
}

export async function generateBundleQR(profile, items) {
  // QR for small bundles (≤ a few items); large ones need file transfer
  const bundle = {
    v: 1,
    app: "BarterNet",
    peer: { id: profile.uid || profile.id, name: profile.name, location: profile.location },
    items: items.filter((i) => i.status === "available").slice(0, 5).map((i) => ({
      id: i.id,
      title: i.title,
      category: i.category,
      wants: i.wants,
    })),
  };
  const json = JSON.stringify(bundle);
  if (json.length > 2900) return null; // too large for QR
  return generateQR(json);
}
