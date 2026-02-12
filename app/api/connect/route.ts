import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { phoneNumber } = body;

    // Chiama Evolution API (dal server, no CORS!)
    const res = await fetch('http://142.93.166.205:8081/instance/create', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': process.env.EVOLUTION_API_KEY || ''
      },
      body: JSON.stringify({
        instanceName: `user_${Date.now()}`,
        qrcode: true,
        integration: "WHATSAPP-BAILEYS",
        number: phoneNumber
      })
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Evolution error: ${res.status} - ${errorText}`);
    }

    const data = await res.json();
    return NextResponse.json(data);

  } catch (error) {
    console.error('API Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}