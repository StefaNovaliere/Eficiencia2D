import { NextResponse } from "next/server";
import { MercadoPagoConfig, Payment } from "mercadopago";

export async function POST(request: Request) {
  const accessToken = process.env.MP_ACCESS_TOKEN;
  if (!accessToken) {
    return NextResponse.json(
      { error: "Mercado Pago no está configurado." },
      { status: 500 },
    );
  }

  let body: { paymentId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body inválido." }, { status: 400 });
  }

  const paymentId = body.paymentId;
  if (!paymentId) {
    return NextResponse.json({ error: "Falta paymentId." }, { status: 400 });
  }

  const client = new MercadoPagoConfig({ accessToken });
  const payment = new Payment(client);

  try {
    const result = await payment.get({ id: paymentId });
    const verified = result.status === "approved";
    return NextResponse.json({ verified, status: result.status });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Error al verificar pago";
    return NextResponse.json({ error: msg, verified: false }, { status: 500 });
  }
}
