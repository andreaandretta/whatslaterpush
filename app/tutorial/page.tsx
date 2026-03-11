'use client';

import React from 'react';

export default function TutorialPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-[#075e54] to-[#128c7e] flex flex-col items-center justify-center px-4 py-12">
      <div className="max-w-md w-full space-y-8">
        <h1 className="text-3xl font-bold text-white text-center">
          Come usare WhatsLater
        </h1>
        <p className="text-white/80 text-center text-lg">
          Programma messaggi WhatsApp in 2 semplici step
        </p>

        {/* Step 1 */}
        <div className="bg-white rounded-2xl p-6 shadow-xl">
          <div className="flex items-center gap-3 mb-4">
            <span className="bg-[#25D366] text-white w-10 h-10 rounded-full flex items-center justify-center font-bold text-lg shrink-0">1</span>
            <h2 className="text-lg font-bold text-gray-800">Allega il contatto</h2>
          </div>
          {/* Animated demo */}
          <div className="bg-[#ECE5DD] rounded-xl p-4 relative overflow-hidden">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 rounded-full bg-[#128c7e] flex items-center justify-center text-white text-xs">Tu</div>
              <span className="text-sm text-gray-600">Chat con WhatsLater</span>
            </div>
            {/* Animated attachment flow */}
            <div className="space-y-3">
              <div className="flex items-end gap-2 animate-fade-in-1">
                <div className="bg-white rounded-lg rounded-bl-none px-3 py-2 shadow-sm max-w-[85%]">
                  <div className="flex items-center gap-2">
                    <span className="text-2xl">📎</span>
                    <span className="text-sm text-gray-500">Premi la graffetta</span>
                  </div>
                </div>
              </div>
              <div className="flex items-end gap-2 animate-fade-in-2">
                <div className="bg-white rounded-lg px-3 py-2 shadow-sm">
                  <div className="flex items-center gap-2">
                    <span className="text-2xl">👤</span>
                    <span className="text-sm text-gray-500">Seleziona "Contatto"</span>
                  </div>
                </div>
              </div>
              <div className="flex items-end gap-2 animate-fade-in-3">
                <div className="bg-[#DCF8C6] rounded-lg rounded-br-none px-3 py-2 shadow-sm ml-auto max-w-[85%]">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-gray-300 flex items-center justify-center text-gray-600 text-xs font-bold">M</div>
                    <div>
                      <p className="text-sm font-semibold text-gray-800">Marco Rossi</p>
                      <p className="text-xs text-gray-500">+39 333 1234567</p>
                    </div>
                  </div>
                </div>
              </div>
              <div className="flex justify-center animate-fade-in-4">
                <span className="bg-[#25D366]/20 text-[#128c7e] text-xs px-3 py-1 rounded-full font-medium">
                  Contatto salvato! Serve solo la prima volta
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Step 2 */}
        <div className="bg-white rounded-2xl p-6 shadow-xl">
          <div className="flex items-center gap-3 mb-4">
            <span className="bg-[#25D366] text-white w-10 h-10 rounded-full flex items-center justify-center font-bold text-lg shrink-0">2</span>
            <h2 className="text-lg font-bold text-gray-800">Scrivi il messaggio</h2>
          </div>
          <div className="bg-[#ECE5DD] rounded-xl p-4">
            <div className="space-y-3">
              <div className="flex items-end justify-end animate-fade-in-5">
                <div className="bg-[#DCF8C6] rounded-lg rounded-br-none px-3 py-2 shadow-sm max-w-[90%]">
                  <p className="text-sm text-gray-800">Invia a Marco domani alle 15: Ricordati la riunione!</p>
                  <p className="text-[10px] text-gray-400 text-right mt-1">14:32 ✓✓</p>
                </div>
              </div>
              <div className="flex items-end animate-fade-in-6">
                <div className="bg-white rounded-lg rounded-bl-none px-3 py-2 shadow-sm max-w-[90%]">
                  <p className="text-sm text-gray-800">
                    ✅ Invierò a Marco Rossi (+39333...) il 12 mar, 15:00:<br/>
                    &quot;Ricordati la riunione!&quot;<br/><br/>
                    Digita <b>OK</b> per confermare o <b>ANNULLA</b> per cancellare.
                  </p>
                  <p className="text-[10px] text-gray-400 text-right mt-1">14:32 ✓✓</p>
                </div>
              </div>
              <div className="flex items-end justify-end animate-fade-in-7">
                <div className="bg-[#DCF8C6] rounded-lg rounded-br-none px-3 py-2 shadow-sm">
                  <p className="text-sm text-gray-800 font-semibold">OK</p>
                  <p className="text-[10px] text-gray-400 text-right mt-1">14:32 ✓✓</p>
                </div>
              </div>
              <div className="flex items-end animate-fade-in-8">
                <div className="bg-white rounded-lg rounded-bl-none px-3 py-2 shadow-sm max-w-[90%]">
                  <p className="text-sm text-gray-800">✅ Confermato! Messaggio a Marco Rossi programmato per 12 mar, 15:00.</p>
                  <p className="text-[10px] text-gray-400 text-right mt-1">14:32 ✓✓</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* CTA */}
        <div className="text-center space-y-4">
          <a
            href="/dashboard"
            className="inline-block bg-[#25D366] text-white px-8 py-4 rounded-2xl font-bold text-lg hover:scale-[1.02] transition-transform shadow-lg"
          >
            Inizia ora — Connetti WhatsApp
          </a>
          <p className="text-white/60 text-sm">Gratis per 7 giorni, nessuna carta richiesta</p>
        </div>
      </div>

      <style jsx>{`
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-fade-in-1 { animation: fadeInUp 0.5s ease-out 0.5s both; }
        .animate-fade-in-2 { animation: fadeInUp 0.5s ease-out 1.2s both; }
        .animate-fade-in-3 { animation: fadeInUp 0.5s ease-out 2.0s both; }
        .animate-fade-in-4 { animation: fadeInUp 0.5s ease-out 2.8s both; }
        .animate-fade-in-5 { animation: fadeInUp 0.5s ease-out 3.5s both; }
        .animate-fade-in-6 { animation: fadeInUp 0.5s ease-out 4.3s both; }
        .animate-fade-in-7 { animation: fadeInUp 0.5s ease-out 5.5s both; }
        .animate-fade-in-8 { animation: fadeInUp 0.5s ease-out 6.3s both; }
      `}</style>
    </div>
  );
}
