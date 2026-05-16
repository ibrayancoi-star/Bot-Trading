import { NextResponse } from "next/server";

export async function GET() {
  const clientId = process.env.CTRADER_CLIENT_ID;
  const redirectUri = process.env.CTRADER_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    return new NextResponse("Missing cTrader credentials in environment variables", { status: 500 });
  }

  // URL oficial de OAuth2 para cTrader Open API
  const authUrl = new URL("https://openapi.ctrader.com/apps/auth");
  authUrl.searchParams.append("client_id", clientId);
  authUrl.searchParams.append("redirect_uri", redirectUri);
  authUrl.searchParams.append("scope", "trading"); // Solicitar permisos de trading

  return NextResponse.redirect(authUrl.toString());
}
