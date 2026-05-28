import { NextResponse } from "next/server";
import { MercadoPagoConfig, Preference } from "mercadopago";

export async function POST(request: Request) {
  const accessToken = process.env.MP_ACCESS_TOKEN;
  if (!accessToken) {
    return NextResponse.json(
      { error: "Mercado Pago no está configurado." },
      { status: 500 },
    );
  }

  const client = new MercadoPagoConfig({ accessToken });
  const preference = new Preference(client);

  const origin = request.headers.get("origin") ?? "https://eficiencia2d.vercel.app";
  const externalReference = crypto.randomUUID();

  try {
    const result = await preference.create({
      body: {
        items: [
          {
            id: "planos",
            title: "Eficiencia2D - Planos de Corte Láser",
            quantity: 1,
            unit_price: 30000,
            currency_id: "ARS",
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
