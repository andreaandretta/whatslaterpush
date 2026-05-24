import { Clock, SmartphoneNfc, Lock } from 'lucide-react';

// Cream benefit strip (between hero and "Come funziona"). Avoid green-on-green
// stacking with the dark-green hero by going to cream. Icons are mint-soft so
// they pop without competing with the primary FAB green elsewhere.
const benefits = [
  { icon: Clock, title: 'Setup in 2 minuti', description: 'Codice a 8 cifre. Niente account, niente carta.' },
  { icon: SmartphoneNfc, title: 'Nessuna app da installare', description: 'Tutto via browser. Funziona anche col telefono spento.' },
  { icon: Lock, title: 'Dal tuo numero personale', description: 'Niente bot, niente sender aziendale. Solo la tua chat.' },
];

export default function StatsBar() {
  return (
    <section className="bg-[#ECE5DD] py-14 border-y border-[#075E54]/10">
      <div className="max-w-5xl mx-auto px-6 grid grid-cols-1 sm:grid-cols-3 gap-8 sm:gap-6">
        {benefits.map((b, i) => (
          <div
            key={i}
            className={`flex items-start gap-4 ${
              i < benefits.length - 1 ? 'sm:border-r sm:border-[#075E54]/15 sm:pr-6' : ''
            }`}
          >
            <div className="shrink-0 w-10 h-10 rounded-full bg-[#25D366] flex items-center justify-center shadow-sm">
              <b.icon className="w-5 h-5 text-white" strokeWidth={2.25} />
            </div>
            <div className="text-left">
              <div className="text-[#075E54] font-semibold text-base leading-tight">{b.title}</div>
              <div className="text-[#54656F] text-sm mt-1 leading-snug">{b.description}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
