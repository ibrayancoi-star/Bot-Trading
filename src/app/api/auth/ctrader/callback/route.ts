import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");

  if (!code) {
    return NextResponse.json({ error: "No se proporcionó código de autorización" }, { status: 400 });
  }

  const clientId = process.env.CTRADER_CLIENT_ID;
  const clientSecret = process.env.CTRADER_CLIENT_SECRET;
  const redirectUri = process.env.CTRADER_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    return NextResponse.json({ error: "Faltan credenciales de cTrader en el entorno" }, { status: 500 });
  }

  try {
    // Intercambiar el código por un Access Token
    const tokenResponse = await fetch("https://openapi.ctrader.com/apps/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
      }),
    });

    const data = await tokenResponse.json();

    if (!tokenResponse.ok) {
      console.error("Error obteniendo token cTrader:", data);
      return NextResponse.json({ error: "Fallo al obtener el access token", details: data }, { status: tokenResponse.status });
    }

    console.log("✅ [OAuth cTrader] Access token obtenido exitosamente:", data);

    // Por ahora, simulamos el almacenamiento devolviendo al usuario al frontend con un mensaje de éxito.
    // En el futuro, podríamos encriptar esto en una cookie de sesión o base de datos.
    const baseUrl = new URL(request.url).origin;
    
    // Redirigir al inicio, podríamos pasar un parámetro como ?connected=true para mostrar feedback en la UI
    return NextResponse.redirect(`${baseUrl}/?ctrader_connected=true`);
  } catch (error) {
    console.error("Error en callback cTrader:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
