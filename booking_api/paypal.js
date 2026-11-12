require("dotenv").config({ quiet: true });

// Defaults to the PayPal sandbox (test money) unless PAYPAL_MODE=live.
const BASE = (
  process.env.PAYPAL_API_BASE ||
  (process.env.PAYPAL_MODE === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com")
).trim();

function getCredentials() {
  const id = (process.env.PAYPAL_CLIENT_ID || "").trim();
  const secret = (process.env.PAYPAL_CLIENT_SECRET || "").trim();
  if (!id || !secret) {
    throw new Error("PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET missing in .env");
  }
  return { id, secret };
}

async function getAccessToken() {
  const { id, secret } = getCredentials();
  const auth = Buffer.from(`${id}:${secret}`).toString("base64");

  const res = await fetch(`${BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(
      data.error_description || data.error || "PayPal auth failed",
    );
  }
  return data.access_token;
}

async function createOrder({
  amount,
  currency,
  description,
  returnUrl,
  cancelUrl,
}) {
  const token = await getAccessToken();
  const value = Number(amount).toFixed(2);

  const res = await fetch(`${BASE}/v2/checkout/orders`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [
        {
          description: description || "Property booking",
          amount: {
            currency_code: currency || "EUR",
            value,
          },
        },
      ],
      application_context: {
        return_url: returnUrl,
        cancel_url: cancelUrl,
        brand_name: "LuxeHome",
        shipping_preference: "NO_SHIPPING",
        user_action: "PAY_NOW",
      },
    }),
  });

  const order = await res.json();
  if (!res.ok) {
    throw new Error(
      order.message ||
        (order.details && order.details[0] && order.details[0].description) ||
        "Create order failed",
    );
  }

  const approve = (order.links || []).find((l) => l.rel === "approve");
  return {
    orderId: order.id,
    approveUrl: approve ? approve.href : null,
  };
}

async function captureOrder(orderId) {
  const token = await getAccessToken();
  const res = await fetch(`${BASE}/v2/checkout/orders/${orderId}/capture`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || "Capture failed");
  return data;
}

module.exports = { createOrder, captureOrder };
