interface SocialProofRowProps {
  users?: string;
  messages?: string;
  rating?: string;
}

type Stat = { value: string; label: string };

const LABELS = {
  users: 'allenatori e gruppi lo usano ogni settimana',
  messages: 'messaggi programmati partiti in automatico',
  rating: 'valutazione media dei primi utenti',
};

export default function SocialProofRow({ users, messages, rating }: SocialProofRowProps) {
  const stats: Stat[] = [];
  if (users) stats.push({ value: users, label: LABELS.users });
  if (messages) stats.push({ value: messages, label: LABELS.messages });
  if (rating) stats.push({ value: rating, label: LABELS.rating });

  if (stats.length === 0) return null;

  // Static class map — Tailwind JIT cannot resolve dynamic `sm:grid-cols-${n}`.
  const colsClass =
    stats.length === 1
      ? 'sm:grid-cols-1'
      : stats.length === 2
      ? 'sm:grid-cols-2'
      : 'sm:grid-cols-3';

  return (
    <section className="bg-[#ECE5DD] py-12 border-y border-[#075E54]/10">
      <div
        className={`max-w-5xl mx-auto px-6 grid grid-cols-1 ${colsClass} gap-8 sm:gap-6`}
      >
        {stats.map((s, i) => (
          <div
            key={i}
            className={`flex flex-col items-center text-center ${
              i < stats.length - 1 ? 'sm:border-r sm:border-[#075E54]/15 sm:pr-6' : ''
            }`}
          >
            <div className="text-3xl font-black text-[#075E54] tracking-tight leading-none">
              {s.value}
            </div>
            <div className="text-xs text-[#54656F] mt-2 leading-snug max-w-[200px]">
              {s.label}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
