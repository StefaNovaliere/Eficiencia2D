import { NextResponse } from "next/server";
import { MercadoPagoConfig, Preference } from "mercadopago";

const DEFAULT_AMOUNT = 30000;

type PreferenceBody = {
  amount?: number;
  currency?: string;
  title?: string;
  itemId?: string;
};

export async function POST(request: Request) {
  const accessToken = process.env.MP_ACCESS_TOKEN;
  if (!accessToken) {
    return NextResponse.json(
      { error: "Mercado Pago no está configurado." },
      { status: 500 },
    );
  }

  let body: PreferenceBody = {};
  try {
    const text = await request.text();
    if (text) body = JSON.parse(text) as PreferenceBody;
  } catch {
    body = {};
  }

  const amount =
    typeof body.amount === "number" && Number.isFinite(body.amount) && body.amount > 0
      ? body.amount
      : DEFAULT_AMOUNT;
  const currency = typeof body.currency === "string" && body.currency.trim()
    ? body.currency.trim().toUpperCase()
    : "ARS";
  const title =
    typeof body.title === "string" && body.title.trim()
      ? body.title.trim()
      : "Eficiencia2D - Planos de Corte Láser";
  const itemId =
    typeof body.itemId === "string" && body.itemId.trim()
      ? body.itemId.trim()
      : "planos";

  const client = new MercadoPagoConfig({ accessToken });
  const preference = new Preference(client);

  const origin = request.headers.get("origin") ?? "https://eficiencia2d.vercel.app";
  const externalReference = crypto.randomUUID();

  try {
    const result = await preference.create({
      body: {
        items: [
          {
            id: itemId,
            title,
            quantity: 1,
            unit_price: amount,
            currency_id: currency,
          },
        ],
        back_urls: {
          success: `${origin}/payment-callback`,
          failure: `${origin}/payment-callback`,
          pending: `${origin}/payment-callback`,
        },
        auto_return: "approved",
        external_reference: externalReference,
        statement_descriptor: "Eficiencia2D",
      },
    });

    return NextResponse.json({
      preferenceId: result.id,
      externalReference,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Error al crear preferencia";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
