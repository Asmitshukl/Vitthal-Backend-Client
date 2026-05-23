type ReminderSourceType = "cart" | "wishlist";

export type ReminderItem = {
  sourceType: ReminderSourceType;
  productName: string;
  productId: string;
  vendorName?: string | null;
  price?: number | null;
  moq?: number | null;
  quantity?: number | null;
  imageUrl?: string | null;
  createdAt: string;
};

type ReminderEmailPayload = {
  userName: string;
  userEmail: string;
  items: ReminderItem[];
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatCurrency(value?: number | null): string {
  if (typeof value !== "number" || Number.isNaN(value) || value <= 0) {
    return "Contact supplier";
  }

  return `₹${value.toLocaleString()}`;
}

function sourceLabel(sourceType: ReminderSourceType): string {
  return sourceType === "cart" ? "Cart" : "Wishlist";
}

export function buildAbandonedReminderEmailHtml(payload: ReminderEmailPayload): string {
  const itemRows = payload.items.map((item) => `
        <tr>
            <td style="padding:16px 0;border-bottom:1px solid #e4e4e7;">
                <div style="display:flex;gap:16px;align-items:flex-start;">
                    <div style="width:72px;height:72px;border-radius:12px;background:#f4f4f5;overflow:hidden;flex-shrink:0;">
                        ${item.imageUrl ? `<img src="${escapeHtml(item.imageUrl)}" alt="${escapeHtml(item.productName)}" style="width:100%;height:100%;object-fit:cover;display:block;" />` : ""}
                    </div>
                    <div style="flex:1;min-width:0;">
                        <div style="font-size:14px;font-weight:700;color:#18181b;margin-bottom:4px;">${escapeHtml(item.productName)}</div>
                        <div style="font-size:12px;color:#71717a;margin-bottom:6px;">${sourceLabel(item.sourceType)} reminder for item added on ${escapeHtml(new Date(item.createdAt).toLocaleString())}</div>
                        <div style="font-size:12px;color:#52525b;line-height:1.6;">
                            ${item.vendorName ? `<div><strong>Supplier:</strong> ${escapeHtml(item.vendorName)}</div>` : ""}
                            <div><strong>Price:</strong> ${escapeHtml(formatCurrency(item.price))}</div>
                            <div><strong>MOQ:</strong> ${escapeHtml(String(item.moq ?? 1))}</div>
                            <div><strong>Quantity:</strong> ${escapeHtml(String(item.quantity ?? 1))}</div>
                            <div><strong>Product ID:</strong> ${escapeHtml(item.productId)}</div>
                        </div>
                    </div>
                </div>
            </td>
        </tr>
    `).join("");

  return `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Reminder from MTWO Groups</title>
  </head>
  <body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;color:#18181b;">
    <div style="max-width:720px;margin:0 auto;padding:24px;">
      <div style="background:#ffffff;border:1px solid #e4e4e7;border-radius:20px;overflow:hidden;box-shadow:0 8px 30px rgba(24,24,27,0.06);">
        <div style="padding:28px 28px 20px;background:linear-gradient(135deg,#1d4ed8 0%,#2563eb 100%);color:#ffffff;">
          <div style="font-size:12px;letter-spacing:0.16em;text-transform:uppercase;font-weight:700;opacity:0.9;">MTWO Group Marketplace</div>
          <h1 style="margin:10px 0 0;font-size:28px;line-height:1.2;">You still have items waiting</h1>
          <p style="margin:12px 0 0;font-size:14px;line-height:1.7;opacity:0.95;max-width:560px;">Hi ${escapeHtml(payload.userName)}, this is a mock reminder for products left in your cart or wishlist for more than 24 hours.</p>
        </div>

        <div style="padding:28px;">
          <div style="font-size:14px;line-height:1.7;color:#52525b;margin-bottom:20px;">
            We are not sending real email yet. This template is ready for SMTP integration, and the cron job logs it to the console for now.
          </div>

          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
            ${itemRows}
          </table>

          <div style="margin-top:24px;padding:16px 18px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:16px;font-size:12px;line-height:1.7;color:#475569;">
            Reminder count: ${payload.items.length}. Once mail credentials are added, this template can be passed to an SMTP transport without changing the reminder query flow.
          </div>
        </div>
      </div>
    </div>
  </body>
</html>
`;
}